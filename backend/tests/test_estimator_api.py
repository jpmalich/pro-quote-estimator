"""Backend API tests for Vinyl Siding Estimator — Iteration 3 (multi-tenant + CSV + Resend)."""
import os
import io
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app-converter-170.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "admin@wolfandson.com")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "Admin123!")
SIGNUP_CODE = os.environ.get("TEST_SIGNUP_CODE") or os.environ.get("SIGNUP_CODE", "")

if not SIGNUP_CODE:
    pytest.skip(
        "SIGNUP_CODE not set — export SIGNUP_CODE (or TEST_SIGNUP_CODE) before running.",
        allow_module_level=True,
    )


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    s.user = r.json()
    return s


def _register(email_prefix="test", company_name=None, invite_code=None):
    s = requests.Session()
    email = f"{email_prefix}_{uuid.uuid4().hex[:8]}@example.com"
    body = {"email": email, "password": "Secret123!", "name": "Tester"}
    if company_name:
        body["company_name"] = company_name
    if invite_code:
        body["invite_code"] = invite_code
    else:
        # iteration-5: creating a new company requires the supplier signup_code
        body["signup_code"] = SIGNUP_CODE
    r = s.post(f"{API}/auth/register", json=body)
    return s, r, email


@pytest.fixture(scope="module")
def company_a_owner():
    s, r, email = _register("ownerA", company_name=f"TEST_CompanyA_{uuid.uuid4().hex[:6]}")
    assert r.status_code == 200, r.text
    s.user = r.json()
    s.test_email = email
    return s


@pytest.fixture(scope="module")
def company_a_member(company_a_owner):
    # Fetch company to get invite code
    c = company_a_owner.get(f"{API}/company").json()
    s, r, email = _register("memberA", invite_code=c["invite_code"])
    assert r.status_code == 200, r.text
    s.user = r.json()
    return s


@pytest.fixture(scope="module")
def company_b_owner():
    s, r, email = _register("ownerB", company_name=f"TEST_CompanyB_{uuid.uuid4().hex[:6]}")
    assert r.status_code == 200, r.text
    s.user = r.json()
    return s


# ---------------- Auth & Company ----------------
class TestAuthAndCompany:
    def test_root(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_register_with_company_name_creates_company(self):
        s, r, email = _register("newco", company_name=f"TEST_NewCo_{uuid.uuid4().hex[:6]}")
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == email
        assert data["role"] == "owner"
        assert data.get("company_id")
        assert "access_token" in s.cookies
        # GET /api/company
        c = s.get(f"{API}/company")
        assert c.status_code == 200
        cdata = c.json()
        assert cdata["id"] == data["company_id"]
        assert "name" in cdata
        assert cdata["owner_user_id"] == data["id"]
        assert "invite_code" in cdata and len(cdata["invite_code"]) >= 6
        assert "created_at" in cdata

    def test_register_with_invite_code_joins_company(self, company_a_owner):
        c = company_a_owner.get(f"{API}/company").json()
        s, r, email = _register("invitee", invite_code=c["invite_code"])
        assert r.status_code == 200
        data = r.json()
        assert data["company_id"] == c["id"]
        assert data["role"] == "member"

    def test_register_with_bad_invite_code(self):
        s, r, _ = _register("bad", invite_code="BADCODE99")
        assert r.status_code == 400
        assert "invalid invite code" in r.json().get("detail", "").lower()

    def test_admin_login_has_company_and_owner_role(self, admin_session):
        me = admin_session.get(f"{API}/auth/me")
        assert me.status_code == 200
        u = me.json()
        assert u["email"] == ADMIN_EMAIL
        assert u.get("role") == "owner"
        assert u.get("company_id")
        assert "password_hash" not in u
        assert "_id" not in u
        # company endpoint works
        c = admin_session.get(f"{API}/company")
        assert c.status_code == 200
        assert c.json()["id"] == u["company_id"]

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_estimates_requires_auth(self):
        r = requests.get(f"{API}/estimates")
        assert r.status_code == 401

    def test_company_requires_auth(self):
        r = requests.get(f"{API}/company")
        assert r.status_code == 401


# ---------------- Catalog (per-company) ----------------
class TestCatalogPerCompany:
    def test_catalog_isolated_between_companies(self, company_a_owner, company_b_owner):
        # Reset both first
        company_a_owner.post(f"{API}/catalog/reset")
        company_b_owner.post(f"{API}/catalog/reset")

        a = company_a_owner.get(f"{API}/catalog").json()
        sections = a["sections"]
        sections[0]["items"][0]["mat"] = 777.77
        r = company_a_owner.put(f"{API}/catalog", json={"sections": sections})
        assert r.status_code == 200

        # B should still have default
        b = company_b_owner.get(f"{API}/catalog").json()
        # iteration-5: default catalog reseeded with Alside Pittsburgh dealer prices
        assert b["sections"][0]["items"][0]["mat"] == 92.19

        # A should have the edited value
        a2 = company_a_owner.get(f"{API}/catalog").json()
        assert a2["sections"][0]["items"][0]["mat"] == 777.77

        # Reset for cleanup
        company_a_owner.post(f"{API}/catalog/reset")


# ---------------- Estimates (company-scoped + misc lines) ----------------
class TestEstimatesMultiTenant:
    def test_misc_lines_roundtrip(self, company_a_owner):
        payload = {
            "customer_name": "TEST_MiscLines",
            "address": "1 Misc St",
            "estimate_number": "M001",
            "lines": [{"section": "Install Vinyl Siding", "name": "Conquest",
                       "unit": "SQ", "qty": 10, "mat": 92.19, "lab": 125}],
            "misc_labor": [{"desc": "Extra carpentry", "mat": 0, "lab": 250}],
            "misc_material": [{"desc": "Custom flashing", "mat": 75, "lab": 50}],
            "waste_pct": 5, "tax_enabled": True, "tax_rate": 7, "margin_pct": 30,
        }
        r = company_a_owner.post(f"{API}/estimates", json=payload)
        assert r.status_code == 200, r.text
        est = r.json()
        assert est["misc_labor"][0]["desc"] == "Extra carpentry"
        assert est["misc_labor"][0]["lab"] == 250
        assert est["misc_material"][0]["desc"] == "Custom flashing"
        assert est["misc_material"][0]["mat"] == 75
        assert "_id" not in est
        assert est.get("company_id") == company_a_owner.user["company_id"]
        company_a_owner.est_id = est["id"]

        # Round-trip with PUT then GET
        update = dict(payload)
        update["misc_labor"] = [{"desc": "Even more carpentry", "mat": 0, "lab": 400}]
        update["misc_material"] = [
            {"desc": "Custom flashing", "mat": 75, "lab": 50},
            {"desc": "Aluminum trim", "mat": 120, "lab": 30},
        ]
        pu = company_a_owner.put(f"{API}/estimates/{est['id']}", json=update)
        assert pu.status_code == 200
        got = company_a_owner.get(f"{API}/estimates/{est['id']}").json()
        assert got["misc_labor"][0]["lab"] == 400
        assert len(got["misc_material"]) == 2
        assert got["misc_material"][1]["desc"] == "Aluminum trim"

    def test_same_company_users_see_each_other(self, company_a_owner, company_a_member):
        lst_owner = company_a_owner.get(f"{API}/estimates").json()
        lst_member = company_a_member.get(f"{API}/estimates").json()
        owner_ids = {e["id"] for e in lst_owner}
        member_ids = {e["id"] for e in lst_member}
        assert company_a_owner.est_id in owner_ids
        assert company_a_owner.est_id in member_ids
        # Member can GET it directly
        g = company_a_member.get(f"{API}/estimates/{company_a_owner.est_id}")
        assert g.status_code == 200
        assert g.json()["customer_name"] == "TEST_MiscLines"

    def test_cross_company_isolation(self, company_a_owner, company_b_owner):
        eid = company_a_owner.est_id
        # B should not see A's estimate in list
        b_list = company_b_owner.get(f"{API}/estimates").json()
        assert eid not in {e["id"] for e in b_list}
        # B cannot GET / PUT / DELETE
        assert company_b_owner.get(f"{API}/estimates/{eid}").status_code == 404
        assert company_b_owner.put(f"{API}/estimates/{eid}", json={"customer_name": "hack"}).status_code == 404
        assert company_b_owner.delete(f"{API}/estimates/{eid}").status_code == 404


# ---------------- CSV Exports ----------------
class TestCSVExports:
    def test_dashboard_csv(self, company_a_owner):
        r = company_a_owner.get(f"{API}/exports/estimates.csv")
        assert r.status_code == 200
        ctype = r.headers.get("content-type", "")
        assert "text/csv" in ctype, f"unexpected content-type: {ctype}"
        body = r.text
        first_line = body.splitlines()[0]
        for expected in ["Estimate #", "Customer", "Address", "Sell Price", "Profit", "Created By", "Updated At"]:
            assert expected in first_line, f"missing column {expected} in header: {first_line}"
        # Should include the estimate we created earlier
        assert "TEST_MiscLines" in body

    def test_per_estimate_csv(self, company_a_owner):
        eid = company_a_owner.est_id
        r = company_a_owner.get(f"{API}/exports/estimates/{eid}.csv")
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        body = r.text
        lines = body.splitlines()
        assert lines[0].startswith("Field,Value"), f"unexpected first line: {lines[0]}"
        # Has line items header somewhere
        assert any("Section,Item,Unit,Qty" in ln for ln in lines), "missing line items header"
        # Has Summary section with Sell Price + Profit
        assert any(ln.startswith("Summary") for ln in lines), "missing Summary section"
        assert any(ln.startswith("Sell Price,") for ln in lines), "missing Sell Price row"
        assert any(ln.startswith("Profit,") for ln in lines), "missing Profit row"

    def test_per_estimate_csv_cross_company_404(self, company_a_owner, company_b_owner):
        eid = company_a_owner.est_id
        r = company_b_owner.get(f"{API}/exports/estimates/{eid}.csv")
        assert r.status_code == 404

    def test_legacy_export_path_removed(self, company_a_owner):
        # Old path should NOT exist anymore
        r = company_a_owner.get(f"{API}/estimates/export.csv")
        assert r.status_code in (404, 405, 422), f"old export.csv path still responding: {r.status_code}"


# ---------------- Email ----------------
class TestEmail:
    def test_email_status_configured(self, company_a_owner):
        r = company_a_owner.get(f"{API}/email/status")
        assert r.status_code == 200
        data = r.json()
        assert data["configured"] is True
        assert data["sender"] == "onboarding@resend.dev"

    def test_email_send_requires_auth(self):
        # Unauthenticated POST returns 401
        r = requests.post(
            f"{API}/estimates/some-id/email",
            json={"recipient_email": "to@example.com", "html_quote": "<p>hi</p>"},
        )
        assert r.status_code == 401

    def test_email_send_missing_estimate_404(self, company_a_owner):
        # Authenticated with a missing estimate ID returns 404 (we deliberately
        # do NOT test the real send path to avoid burning Resend quota).
        fake_id = str(uuid.uuid4())
        r = company_a_owner.post(
            f"{API}/estimates/{fake_id}/email",
            json={"recipient_email": "to@example.com", "html_quote": "<p>hi</p>"},
        )
        assert r.status_code == 404


# ---------------- Uploads (regression) ----------------
class TestUploads:
    def test_upload_and_serve(self, company_a_owner):
        png_bytes = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
                     b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
                     b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
                     b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82")
        files = {"file": ("test.png", io.BytesIO(png_bytes), "image/png")}
        r = company_a_owner.post(f"{API}/uploads", files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["url"].startswith("/api/uploads/")
        g = requests.get(BASE_URL + data["url"])
        assert g.status_code == 200
        assert g.content == png_bytes


# ---------------- Cleanup ----------------
class TestCleanup:
    def test_delete_test_estimate(self, company_a_owner):
        eid = getattr(company_a_owner, "est_id", None)
        if eid:
            r = company_a_owner.delete(f"{API}/estimates/{eid}")
            assert r.status_code in (200, 404)
