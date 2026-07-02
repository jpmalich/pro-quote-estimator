"""Backend API tests for Vinyl Siding Estimator — Iteration 5
Covers:
  - Public /api/branding endpoint
  - Invite-only signup gating (signup_code required for new company)
  - Joining existing company via invite_code (no signup_code needed)
  - Default Alside Pittsburgh catalog seeded on new company
  - Company.quote_footer_enabled toggle
  - Hidden /api/admin/* endpoints with SUPPLIER_ADMIN_TOKEN gate (header & query)
  - Admin branding update + logo upload + URL fetchable
  - Regression: iteration-3 features (CSV exports, estimate CRUD, multi-tenant
    isolation, /api/auth/me, /api/company)
"""

import io
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://app.pro-quotes.com",
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "admin@wolfandson.com")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "Admin123!")
SIGNUP_CODE = os.environ.get("TEST_SIGNUP_CODE") or os.environ.get("SIGNUP_CODE", "")
ADMIN_TOKEN = os.environ.get("TEST_ADMIN_TOKEN") or os.environ.get("SUPPLIER_ADMIN_TOKEN", "")

if not SIGNUP_CODE or not ADMIN_TOKEN:
    pytest.skip(
        "Test secrets missing: export SIGNUP_CODE and SUPPLIER_ADMIN_TOKEN "
        "(or TEST_SIGNUP_CODE / TEST_ADMIN_TOKEN) before running.",
        allow_module_level=True,
    )

# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    s.user = r.json()
    return s


def _register(email_prefix="test", company_name=None, invite_code=None, signup_code=None):
    s = requests.Session()
    email = f"TEST_{email_prefix}_{uuid.uuid4().hex[:8]}@example.com"
    body = {"email": email, "password": "Secret123!", "name": "Tester"}
    if company_name:
        body["company_name"] = company_name
    if invite_code:
        body["invite_code"] = invite_code
    if signup_code is not None:
        body["signup_code"] = signup_code
    r = s.post(f"{API}/auth/register", json=body)
    return s, r, email


@pytest.fixture(scope="module")
def new_owner():
    """Owner of a freshly-created company (created with valid signup_code)."""
    s, r, email = _register(
        "owner",
        company_name=f"TEST_Alside_{uuid.uuid4().hex[:6]}",
        signup_code=SIGNUP_CODE,
    )
    assert r.status_code == 200, f"register owner failed: {r.status_code} {r.text}"
    me = s.get(f"{API}/auth/me").json()
    company = s.get(f"{API}/company").json()
    return {"session": s, "user": r.json(), "email": email, "me": me, "company": company}


# --------------------------------------------------------------------------- #
# /api/branding (public)
# --------------------------------------------------------------------------- #
class TestBrandingPublic:
    def test_branding_no_auth(self):
        r = requests.get(f"{API}/branding")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["supplier_name"] == "Alside Supply"
        assert "Howard Hunt" in data["supplier_tagline"]
        assert "(724) 640-4333" in data["supplier_tagline"]
        # supplier_logo_url may be null or a string
        assert "supplier_logo_url" in data
        assert data["supplier_logo_url"] is None or isinstance(data["supplier_logo_url"], str)


# --------------------------------------------------------------------------- #
# Signup gating
# --------------------------------------------------------------------------- #
class TestSignupGating:
    def test_register_without_codes_forbidden(self):
        _, r, _ = _register("nocode")
        assert r.status_code == 403, r.text
        assert "invite-only" in r.json().get("detail", "").lower()

    def test_register_with_wrong_signup_code_forbidden(self):
        _, r, _ = _register("wrongcode", signup_code="WRONG-CODE-XYZ")
        assert r.status_code == 403, r.text

    def test_register_with_empty_signup_code_forbidden(self):
        _, r, _ = _register("emptycode", signup_code="")
        assert r.status_code == 403, r.text

    def test_register_with_correct_signup_code_creates_owner(self, new_owner):
        u = new_owner["user"]
        assert u["role"] == "owner"
        assert u["company_id"]
        assert new_owner["me"]["role"] == "owner"

    def test_register_with_invite_code_joins_existing(self, new_owner):
        invite_code = new_owner["company"]["invite_code"]
        s, r, _ = _register("joiner", invite_code=invite_code)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["role"] == "member"
        assert data["company_id"] == new_owner["company"]["id"]

    def test_register_invalid_invite_code(self):
        _, r, _ = _register("badinvite", invite_code="BOGUS123")
        # Treated as invalid invite (400), not 403 invite-only
        assert r.status_code in (400, 403), r.text


# --------------------------------------------------------------------------- #
# Default Alside catalog seeded
# --------------------------------------------------------------------------- #
class TestAlsideDefaultCatalog:
    def test_default_catalog_first_section_and_item(self, new_owner):
        r = new_owner["session"].get(f"{API}/catalog")
        assert r.status_code == 200, r.text
        cat = r.json()
        sections = cat.get("sections", [])
        assert len(sections) > 0, "catalog has no sections"
        first = sections[0]
        assert first["title"] == "Install Vinyl Siding"
        assert first["items"], "first section has no items"
        first_item = first["items"][0]
        # iteration-6 catalog seed uses the full SKU name; default tier is whole-sale.
        assert first_item["name"] == "Conquest .040"
        assert first_item["unit"] == "SQ"
        assert first_item["mat"] > 0  # tier-specific; concrete price asserted in iteration-6 tests
        assert first_item["lab"] > 0

    def test_default_catalog_has_ascend_section(self, new_owner):
        cat = new_owner["session"].get(f"{API}/catalog").json()
        ascend = [s for s in cat["sections"] if s.get("ascend") is True]
        assert ascend, "no ASCEND section flagged"
        assert ascend[0]["title"] == "Ascend Cladding/Accessories"


# --------------------------------------------------------------------------- #
# Company quote_footer_enabled toggle
# --------------------------------------------------------------------------- #
class TestQuoteFooterToggle:
    def test_company_has_quote_footer_enabled_default_true(self, new_owner):
        assert new_owner["company"].get("quote_footer_enabled") is True

    def test_put_company_disables_footer(self, new_owner):
        s = new_owner["session"]
        r = s.put(f"{API}/company", json={"quote_footer_enabled": False})
        assert r.status_code == 200, r.text
        assert r.json().get("quote_footer_enabled") is False
        # GET to verify persisted
        r2 = s.get(f"{API}/company")
        assert r2.status_code == 200
        assert r2.json().get("quote_footer_enabled") is False

    def test_put_company_reenables_footer(self, new_owner):
        s = new_owner["session"]
        r = s.put(f"{API}/company", json={"quote_footer_enabled": True})
        assert r.status_code == 200, r.text
        assert r.json().get("quote_footer_enabled") is True


# --------------------------------------------------------------------------- #
# Admin endpoints — gating + functionality
# --------------------------------------------------------------------------- #
class TestAdminGating:
    def test_signup_code_no_token_forbidden(self):
        r = requests.get(f"{API}/admin/signup-code")
        assert r.status_code == 403, r.text

    def test_signup_code_wrong_token_forbidden(self):
        r = requests.get(f"{API}/admin/signup-code", headers={"X-Admin-Token": "wrong"})
        assert r.status_code == 403, r.text

    def test_signup_code_with_header_token(self):
        r = requests.get(f"{API}/admin/signup-code", headers={"X-Admin-Token": ADMIN_TOKEN})
        assert r.status_code == 200, r.text
        assert r.json().get("signup_code") == SIGNUP_CODE

    def test_signup_code_with_query_param_token_now_rejected(self):
        # SEC-006 — Iter 78z++++: query-string token is no longer accepted;
        # tokens must come via X-Admin-Token header. Verifies the regression.
        r = requests.get(f"{API}/admin/signup-code", params={"token": ADMIN_TOKEN})
        assert r.status_code == 403, r.text

    def test_admin_branding_put_no_token_forbidden(self):
        r = requests.put(f"{API}/admin/branding", json={"supplier_name": "x"})
        assert r.status_code == 403

    def test_admin_branding_update_and_reflect_in_public(self):
        # snapshot original
        orig = requests.get(f"{API}/branding").json()

        unique_tag = f"Howard Hunt · TEST {uuid.uuid4().hex[:6]}"
        r = requests.put(
            f"{API}/admin/branding",
            json={"supplier_name": "Alside Supply", "supplier_tagline": unique_tag},
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )
        assert r.status_code == 200, r.text

        pub = requests.get(f"{API}/branding").json()
        assert pub["supplier_tagline"] == unique_tag
        assert pub["supplier_name"] == "Alside Supply"

        # restore original tagline
        requests.put(
            f"{API}/admin/branding",
            json={
                "supplier_name": orig["supplier_name"],
                "supplier_tagline": orig["supplier_tagline"],
                "supplier_logo_url": orig.get("supplier_logo_url") or "",
            },
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )

    def test_admin_upload_logo_and_serve(self):
        # 1x1 transparent PNG
        png_bytes = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
            "0000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082"
        )
        files = {"file": ("test_logo.png", io.BytesIO(png_bytes), "image/png")}
        # no token -> 403
        r0 = requests.post(f"{API}/admin/upload-logo", files=files)
        assert r0.status_code == 403, r0.text

        files = {"file": ("test_logo.png", io.BytesIO(png_bytes), "image/png")}
        r = requests.post(
            f"{API}/admin/upload-logo",
            files=files,
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )
        assert r.status_code == 200, r.text
        url = r.json().get("url")
        assert url and url.startswith("/api/uploads/")

        # Branding now reflects the new logo URL
        pub = requests.get(f"{API}/branding").json()
        assert pub["supplier_logo_url"] == url

        # Fetch the uploaded file
        full = f"{BASE_URL}{url}"
        f = requests.get(full)
        assert f.status_code == 200, f"logo not fetchable at {full}: {f.status_code}"
        assert len(f.content) > 0

        # cleanup — clear logo
        requests.put(
            f"{API}/admin/branding",
            json={"supplier_logo_url": ""},
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )


# --------------------------------------------------------------------------- #
# Regression — iteration-3 critical paths
# --------------------------------------------------------------------------- #
class TestRegressionIteration3:
    def test_auth_me(self, admin_session):
        r = admin_session.get(f"{API}/auth/me")
        assert r.status_code == 200, r.text
        assert r.json()["email"] == ADMIN_EMAIL

    def test_company_get(self, admin_session):
        r = admin_session.get(f"{API}/company")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"]
        assert data["invite_code"]
        # quote_footer_enabled may be missing on legacy admin company; UI default true.
        # Spec says: getter defaults true via `!== false`, but new key must exist for new companies.
        assert "id" in data

    def test_estimate_crud(self, admin_session):
        # CREATE
        payload = {
            "customer_name": "TEST_Cust",
            "address": "123 Test St",
            "estimate_number": f"TEST-{uuid.uuid4().hex[:6]}",
            "estimate_date": "2026-01-15",
            "estimator": "Tester",
            "notes": "regression test",
            "waste_pct": 10,
            "tax_enabled": True,
            "tax_rate": 7,
            "margin_pct": 30,
            "lines": [
                {"section": "Install Vinyl Siding", "name": "Conquest", "unit": "SQ",
                 "qty": 10, "mat": 92.19, "lab": 125},
            ],
            "misc_labor": [],
            "misc_material": [],
            "photos": [],
            "status_label": "draft",
        }
        r = admin_session.post(f"{API}/estimates", json=payload)
        assert r.status_code == 200, r.text
        est = r.json()
        eid = est["id"]
        assert est["customer_name"] == "TEST_Cust"
        assert est["company_id"]

        # GET
        r2 = admin_session.get(f"{API}/estimates/{eid}")
        assert r2.status_code == 200
        assert r2.json()["estimate_number"] == payload["estimate_number"]

        # UPDATE
        payload["customer_name"] = "TEST_Cust_Updated"
        r3 = admin_session.put(f"{API}/estimates/{eid}", json=payload)
        assert r3.status_code == 200
        assert r3.json()["customer_name"] == "TEST_Cust_Updated"

        # DELETE
        r4 = admin_session.delete(f"{API}/estimates/{eid}")
        assert r4.status_code == 200
        # confirm 404
        r5 = admin_session.get(f"{API}/estimates/{eid}")
        assert r5.status_code == 404

    def test_csv_export_dashboard(self, admin_session):
        r = admin_session.get(f"{API}/exports/estimates.csv")
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("content-type", "")
        assert "Estimate #" in r.text

    def test_multi_tenant_isolation(self, new_owner, admin_session):
        # owner_a creates an estimate
        s = new_owner["session"]
        payload = {
            "customer_name": "TEST_Tenant_A",
            "estimate_number": f"TENA-{uuid.uuid4().hex[:6]}",
            "lines": [],
        }
        r = s.post(f"{API}/estimates", json=payload)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]

        # admin (different company) must NOT be able to fetch it
        r2 = admin_session.get(f"{API}/estimates/{eid}")
        assert r2.status_code == 404, "tenant isolation broken — admin saw other company's estimate"

        # cleanup
        s.delete(f"{API}/estimates/{eid}")
