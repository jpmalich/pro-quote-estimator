"""Backend API tests for Vinyl Siding Estimator — Iteration 6 (4-Tier Pricing)

Covers:
  - /api/admin/tiers list (token-gated, 4 seeded tiers)
  - /api/admin/tiers/{id} GET/PUT (404, persistence)
  - /api/admin/companies (token-gated, with tier_name + estimate_count)
  - /api/admin/companies/{id}/tier assign (400 / 404 / 200 + persistence)
  - GET /api/catalog returns tier_id/tier_name/tier_mat/tier_lab/{mat,lab}_overridden
  - Switching tier changes the contractor's catalog mat
  - PUT /api/catalog strips `mat` overrides; only `lab` persists
  - POST /api/catalog/reset clears overrides
  - Two-contractor isolation (different tiers, no labor bleed)
  - Estimate CRUD regression
  - Regression: /api/branding, signup gating, /api/email/status, CSV export
"""

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
        "SIGNUP_CODE and SUPPLIER_ADMIN_TOKEN must be set in env to run iteration-6 tests.",
        allow_module_level=True,
    )

EXPECTED_TIER_NAMES = {"one-opp", "Builder-Dealer", "Contractor", "whole-sale"}


# -------- helpers --------
def _register(prefix, signup_code=SIGNUP_CODE, invite_code=None, company_name=None):
    s = requests.Session()
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"
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
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def all_tiers():
    r = requests.get(f"{API}/admin/tiers", headers={"X-Admin-Token": ADMIN_TOKEN})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def tier_by_name(all_tiers):
    return {t["name"]: t for t in all_tiers}


@pytest.fixture(scope="module")
def contractor_a():
    s, r, _ = _register("A", company_name=f"TEST_CoA_{uuid.uuid4().hex[:5]}")
    assert r.status_code == 200, r.text
    return {"s": s, "user": r.json()}


@pytest.fixture(scope="module")
def contractor_b():
    s, r, _ = _register("B", company_name=f"TEST_CoB_{uuid.uuid4().hex[:5]}")
    assert r.status_code == 200, r.text
    return {"s": s, "user": r.json()}


# ============================== TIERS LIST/CRUD ==============================
class TestAdminTiers:
    def test_list_tiers_no_token_forbidden(self):
        r = requests.get(f"{API}/admin/tiers")
        assert r.status_code == 403

    def test_list_tiers_returns_4_seeded(self, all_tiers):
        assert len(all_tiers) >= 4
        names = {t["name"] for t in all_tiers}
        assert EXPECTED_TIER_NAMES.issubset(names), f"missing tiers, got {names}"
        # Every tier should have sections
        for t in all_tiers:
            if t["name"] in EXPECTED_TIER_NAMES:
                assert isinstance(t.get("sections"), list) and len(t["sections"]) > 0
                assert "id" in t

    def test_get_tier_by_id(self, tier_by_name):
        tid = tier_by_name["Contractor"]["id"]
        r = requests.get(f"{API}/admin/tiers/{tid}", headers={"X-Admin-Token": ADMIN_TOKEN})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == tid
        assert data["name"] == "Contractor"
        assert data["sections"]

    def test_get_tier_no_token_403(self, tier_by_name):
        tid = tier_by_name["Contractor"]["id"]
        r = requests.get(f"{API}/admin/tiers/{tid}")
        assert r.status_code == 403

    def test_get_tier_unknown_404(self):
        r = requests.get(f"{API}/admin/tiers/does-not-exist",
                         headers={"X-Admin-Token": ADMIN_TOKEN})
        assert r.status_code == 404

    def test_put_tier_persists(self, tier_by_name):
        tid = tier_by_name["whole-sale"]["id"]
        # GET current then bump a single mat value
        cur = requests.get(f"{API}/admin/tiers/{tid}",
                           headers={"X-Admin-Token": ADMIN_TOKEN}).json()
        original_mat = cur["sections"][0]["items"][0]["mat"]
        new_mat = float(original_mat) + 1.23
        cur["sections"][0]["items"][0]["mat"] = new_mat

        r = requests.put(
            f"{API}/admin/tiers/{tid}",
            json={"sections": cur["sections"]},
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )
        assert r.status_code == 200, r.text
        assert abs(r.json()["sections"][0]["items"][0]["mat"] - new_mat) < 1e-6

        # Re-GET confirms persistence
        again = requests.get(f"{API}/admin/tiers/{tid}",
                             headers={"X-Admin-Token": ADMIN_TOKEN}).json()
        assert abs(again["sections"][0]["items"][0]["mat"] - new_mat) < 1e-6

        # Restore original
        cur["sections"][0]["items"][0]["mat"] = original_mat
        requests.put(f"{API}/admin/tiers/{tid}", json={"sections": cur["sections"]},
                     headers={"X-Admin-Token": ADMIN_TOKEN})


# ============================== ADMIN COMPANIES ==============================
class TestAdminCompanies:
    def test_list_companies_no_token(self):
        r = requests.get(f"{API}/admin/companies")
        assert r.status_code == 403

    def test_list_companies_with_token(self, contractor_a):
        r = requests.get(f"{API}/admin/companies", headers={"X-Admin-Token": ADMIN_TOKEN})
        assert r.status_code == 200, r.text
        companies = r.json()
        assert isinstance(companies, list) and len(companies) >= 1
        # Each must have tier_name + estimate_count
        for c in companies:
            assert "tier_name" in c
            assert "estimate_count" in c
            assert isinstance(c["estimate_count"], int)
        # contractor_a's company should be present
        my_co_id = contractor_a["user"]["company_id"]
        assert any(c["id"] == my_co_id for c in companies)

    def test_assign_tier_unknown_tier_400(self, contractor_a):
        co_id = contractor_a["user"]["company_id"]
        r = requests.put(
            f"{API}/admin/companies/{co_id}/tier",
            json={"price_tier_id": "no-such-tier-id"},
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )
        assert r.status_code == 400

    def test_assign_tier_unknown_company_404(self, tier_by_name):
        r = requests.put(
            f"{API}/admin/companies/does-not-exist/tier",
            json={"price_tier_id": tier_by_name["Contractor"]["id"]},
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )
        assert r.status_code == 404

    def test_assign_tier_success_and_persistence(self, contractor_a, tier_by_name):
        co_id = contractor_a["user"]["company_id"]
        new_tid = tier_by_name["Contractor"]["id"]
        r = requests.put(
            f"{API}/admin/companies/{co_id}/tier",
            json={"price_tier_id": new_tid},
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )
        assert r.status_code == 200, r.text
        assert r.json()["price_tier_id"] == new_tid
        # Verify on list
        companies = requests.get(f"{API}/admin/companies",
                                 headers={"X-Admin-Token": ADMIN_TOKEN}).json()
        co = next(c for c in companies if c["id"] == co_id)
        assert co["price_tier_id"] == new_tid
        assert co["tier_name"] == "Contractor"


# ============================== /api/catalog (CONTRACTOR) ==============================
class TestContractorCatalog:
    def test_catalog_returns_tier_fields(self, contractor_a):
        r = contractor_a["s"].get(f"{API}/catalog")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "tier_id" in data and "tier_name" in data
        assert data["sections"]
        item = data["sections"][0]["items"][0]
        for k in ("mat", "lab", "tier_mat", "tier_lab", "mat_overridden", "lab_overridden"):
            assert k in item, f"missing field {k} on catalog item"
        # initially no overrides
        assert item["mat_overridden"] is False
        assert item["lab_overridden"] is False
        # mat should equal tier_mat (no override)
        assert abs(item["mat"] - item["tier_mat"]) < 1e-6

    def test_switching_tier_changes_mat(self, contractor_a, tier_by_name):
        co_id = contractor_a["user"]["company_id"]
        # Assign one-opp
        requests.put(
            f"{API}/admin/companies/{co_id}/tier",
            json={"price_tier_id": tier_by_name["one-opp"]["id"]},
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )
        cat1 = contractor_a["s"].get(f"{API}/catalog").json()
        mat_one_opp = cat1["sections"][0]["items"][0]["mat"]
        assert cat1["tier_name"] == "one-opp"

        # Switch to whole-sale
        requests.put(
            f"{API}/admin/companies/{co_id}/tier",
            json={"price_tier_id": tier_by_name["whole-sale"]["id"]},
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )
        cat2 = contractor_a["s"].get(f"{API}/catalog").json()
        mat_ws = cat2["sections"][0]["items"][0]["mat"]
        assert cat2["tier_name"] == "whole-sale"
        assert mat_one_opp != mat_ws, (
            f"expected different mat across tiers, both = {mat_one_opp}"
        )

    def test_put_catalog_strips_mat_only_lab_persists(self, contractor_a):
        cat = contractor_a["s"].get(f"{API}/catalog").json()
        section_title = cat["sections"][0]["title"]
        item = cat["sections"][0]["items"][0]
        key = f"{section_title}::{item['name']}"
        original_tier_mat = item["tier_mat"]

        # Try to override BOTH mat and lab — backend must drop mat
        r = contractor_a["s"].put(f"{API}/catalog", json={
            "overrides": {key: {"mat": 99999.99, "lab": 555.55}}
        })
        assert r.status_code == 200, r.text

        # Re-fetch
        cat2 = contractor_a["s"].get(f"{API}/catalog").json()
        it2 = next(i for i in cat2["sections"][0]["items"] if i["name"] == item["name"])
        assert it2["mat_overridden"] is False, "material should NOT be override-able by contractor"
        assert abs(it2["mat"] - original_tier_mat) < 1e-6
        assert it2["lab_overridden"] is True
        assert abs(it2["lab"] - 555.55) < 1e-6

    def test_reset_clears_labor_overrides(self, contractor_a):
        r = contractor_a["s"].post(f"{API}/catalog/reset")
        assert r.status_code == 200, r.text
        data = r.json()
        # All items: no overrides + mat==tier_mat
        for s in data["sections"]:
            for it in s["items"]:
                assert it["mat_overridden"] is False
                assert it["lab_overridden"] is False
                assert abs(it["mat"] - it["tier_mat"]) < 1e-6
                assert abs(it["lab"] - it["tier_lab"]) < 1e-6


# ============================== ISOLATION (A vs B) ==============================
class TestContractorIsolation:
    def test_two_contractors_different_tiers_no_bleed(self, contractor_a, contractor_b,
                                                       tier_by_name):
        # A -> one-opp, B -> Builder-Dealer
        requests.put(
            f"{API}/admin/companies/{contractor_a['user']['company_id']}/tier",
            json={"price_tier_id": tier_by_name["one-opp"]["id"]},
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )
        requests.put(
            f"{API}/admin/companies/{contractor_b['user']['company_id']}/tier",
            json={"price_tier_id": tier_by_name["Builder-Dealer"]["id"]},
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )

        catA = contractor_a["s"].get(f"{API}/catalog").json()
        catB = contractor_b["s"].get(f"{API}/catalog").json()

        assert catA["tier_name"] == "one-opp"
        assert catB["tier_name"] == "Builder-Dealer"
        # Find a siding item to compare
        a_first = catA["sections"][0]["items"][0]
        b_first = catB["sections"][0]["items"][0]
        assert a_first["name"] == b_first["name"], "structure differs across tiers"
        assert a_first["mat"] != b_first["mat"], "tiers should produce different mat"

        # A sets a labor override; B's catalog must NOT change
        section = catA["sections"][0]["title"]
        key = f"{section}::{a_first['name']}"
        contractor_a["s"].put(f"{API}/catalog",
                              json={"overrides": {key: {"lab": 777}}})
        catB2 = contractor_b["s"].get(f"{API}/catalog").json()
        b_first2 = catB2["sections"][0]["items"][0]
        assert b_first2["lab_overridden"] is False
        assert abs(b_first2["lab"] - b_first["lab"]) < 1e-6

        # cleanup A overrides
        contractor_a["s"].post(f"{API}/catalog/reset")


# ============================== ESTIMATE CRUD REGRESSION ==============================
class TestEstimateCRUD:
    def test_estimate_full_cycle(self, contractor_a):
        s = contractor_a["s"]
        cat = s.get(f"{API}/catalog").json()
        item = cat["sections"][0]["items"][0]

        payload = {
            "customer_name": "TEST_Cust",
            "estimate_number": f"TEST-{uuid.uuid4().hex[:6]}",
            "lines": [{
                "section": cat["sections"][0]["title"],
                "name": item["name"],
                "unit": item["unit"],
                "qty": 5,
                "mat": item["mat"],
                "lab": item["lab"],
            }],
            "misc_labor": [], "misc_material": [], "photos": [],
            "status_label": "draft",
        }
        # CREATE
        r = s.post(f"{API}/estimates", json=payload)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        assert isinstance(r.json()["lines"][0]["mat"], (int, float))

        # GET
        r2 = s.get(f"{API}/estimates/{eid}")
        assert r2.status_code == 200

        # UPDATE
        payload["customer_name"] = "TEST_Cust_v2"
        r3 = s.put(f"{API}/estimates/{eid}", json=payload)
        assert r3.status_code == 200
        assert r3.json()["customer_name"] == "TEST_Cust_v2"

        # DELETE
        r4 = s.delete(f"{API}/estimates/{eid}")
        assert r4.status_code == 200
        assert s.get(f"{API}/estimates/{eid}").status_code == 404


# ============================== REGRESSION (public/email/csv/signup) ==========
class TestRegression:
    def test_branding_public(self):
        r = requests.get(f"{API}/branding")
        assert r.status_code == 200
        assert r.json()["supplier_name"]

    def test_signup_gating_still_enforced(self):
        _, r, _ = _register("nocode", signup_code=None)
        assert r.status_code == 403

    def test_signup_with_correct_code(self):
        _, r, _ = _register("good", signup_code=SIGNUP_CODE)
        assert r.status_code == 200

    def test_email_status_requires_auth(self):
        r = requests.get(f"{API}/email/status")
        assert r.status_code == 401

    def test_email_status_authed(self, admin_session):
        r = admin_session.get(f"{API}/email/status")
        assert r.status_code == 200
        assert "configured" in r.json()

    def test_estimates_csv(self, admin_session):
        r = admin_session.get(f"{API}/exports/estimates.csv")
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
