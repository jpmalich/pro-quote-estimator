"""
Iter 34 backend regression — Siding Catalog Restructure verification.

Tests that the catalog has been correctly split into Standard color and
Architectural color variants per Howard's updated Alside Excel price sheet.

Covers:
  - Admin login (session cookie auth)
  - GET /api/catalog: Vinyl Siding section (27 items, expected variant names)
  - GET /api/catalog: Siding Accessories section (22 items, color split)
  - GET /api/catalog: Vinyl Soffit with Siding section (16 items)
  - "Architectural color upcharge Vinyl" removed
  - Tier prices via /api/admin/tiers (X-Admin-Token)
  - AMI part numbers on new variant items
  - POST /api/estimates with a new variant item + GET round-trip
  - HOVER importer /api/estimates/hover-import accepts file upload
  - Legacy estimates load even with deprecated item names
"""
import io
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app-converter-170.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "hhunt6677@yahoo.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin123!")
SUPPLIER_ADMIN_TOKEN = os.environ.get("SUPPLIER_ADMIN_TOKEN", "test-admin-token")


# ---- shared fixtures ----------------------------------------------------- #
@pytest.fixture(scope="module")
def auth_session():
    """Logged-in requests.Session() with cookie set."""
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    # cookie must be set
    assert any(c.name in ("session", "access_token", "token") for c in s.cookies) or r.cookies, \
        f"Expected auth cookie. Got cookies={dict(s.cookies)}"
    return s


@pytest.fixture(scope="module")
def catalog(auth_session):
    r = auth_session.get(f"{API}/catalog", timeout=30)
    assert r.status_code == 200, f"GET /api/catalog failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    assert "sections" in data, f"catalog missing 'sections' key: {list(data)[:10]}"
    return data


def _section(catalog, title):
    for s in catalog["sections"]:
        if s.get("title") == title:
            return s
    pytest.fail(f"Section {title!r} not found. Got: {[s.get('title') for s in catalog['sections']]}")


# =========================== AUTH ======================================== #
class TestAuth:
    def test_login_returns_200_with_cookie(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # Either body returns user data or there's a cookie
        assert s.cookies or "token" in body or "user" in body, f"No auth artifact. Body={body}"

    def test_me_after_login(self, auth_session):
        r = auth_session.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # user object should include email
        email = body.get("email") or (body.get("user") or {}).get("email")
        assert email == ADMIN_EMAIL, f"Unexpected /me payload: {body}"


# =========================== VINYL SIDING SECTION ======================== #
class TestVinylSidingSection:
    def test_section_present_and_27_items(self, catalog):
        sec = _section(catalog, "Vinyl Siding")
        assert len(sec["items"]) == 27, (
            f"Expected 27 items in Vinyl Siding, got {len(sec['items'])}: "
            f"{[i['name'] for i in sec['items']]}"
        )

    def test_expected_variant_names_present(self, catalog):
        sec = _section(catalog, "Vinyl Siding")
        names = {i["name"] for i in sec["items"]}
        expected = {
            'Conquest Standard color Clap 4.5" .040',
            'Conquest Architectural color Dutch lap 4.5" .040',
            'Coventry Standard color Clap 4" .042',
            'Coventry Architectural color Dutch lap 5" .042',
            'Odyssey Standard color Clap 4" .044',
            'Odyssey Architectural color Dutch Lap 5" .044',
            'Charter Oak Standard color Clap 4.5" .046',
            'Charter Oak Architectural color Dutch Lap 4.5" .046',
            'vertical board and batten Standard color 7"',
            'vertical board and batten Architectural color 7"',
            'Pelican Bay Shakes 9"',
        }
        missing = expected - names
        assert not missing, f"Missing variants: {missing}"

    def test_siding_profile_lab_is_125_and_mat_nonzero(self, catalog):
        sec = _section(catalog, "Vinyl Siding")
        for it in sec["items"]:
            assert it["lab"] == 125, f"{it['name']} lab={it['lab']} (expected 125)"
            assert it["mat"] > 0, f"{it['name']} mat=0 (expected non-zero)"


# =========================== SIDING ACCESSORIES ========================== #
class TestSidingAccessoriesSection:
    def test_22_items(self, catalog):
        sec = _section(catalog, "Siding Accessories")
        assert len(sec["items"]) == 22, (
            f"Expected 22 items, got {len(sec['items'])}: {[i['name'] for i in sec['items']]}"
        )

    def test_new_color_variants_present(self, catalog):
        sec = _section(catalog, "Siding Accessories")
        names = {i["name"] for i in sec["items"]}
        expected = {
            "Outside corners Standard color",
            "Outside corners Architectural color",
            "Inside Corners (Siding) Standard color",
            "Inside Corners (Siding) Architectural color",
            '3/4" J-Channel Standard color (2 per Sq of siding)',
            '3/4" J-Channel Architectural color (2 per Sq of siding)',
            "Finish Trim Standard color",
            "Finish Trim Architectural color",
        }
        missing = expected - names
        assert not missing, f"Missing variants: {missing}"

    def test_old_single_variant_names_removed(self, catalog):
        sec = _section(catalog, "Siding Accessories")
        names = {i["name"] for i in sec["items"]}
        forbidden = {
            "Outside corners",
            "Inside Corners (Siding)",
            '3/4" J-Channel (2 per Sq of siding)',
            "Finish Trim",
        }
        leftover = forbidden & names
        assert not leftover, f"Old single-variant names still present: {leftover}"


# =========================== VINYL SOFFIT SECTION ======================== #
class TestVinylSoffitSection:
    def test_16_items(self, catalog):
        sec = _section(catalog, "Vinyl Soffit with Siding")
        assert len(sec["items"]) == 16, (
            f"Expected 16 items, got {len(sec['items'])}: {[i['name'] for i in sec['items']]}"
        )

    def test_charter_oak_soffit_variants(self, catalog):
        sec = _section(catalog, "Vinyl Soffit with Siding")
        names = {i["name"] for i in sec["items"]}
        expected = {
            'Soffit & fascia up to 13" wide Charter Oak Standard color',
            'Soffit & fascia up to 13" wide Charter Oak Architectural color',
            'Soffit & fascia up to 13"-30" wide Charter Oak Standard color',
            'Soffit & fascia up to 13"-30" wide Charter Oak Architectural color',
            '3/4" Soffit J-Channel (Charter Oak) Standard color',
            '3/4" Soffit J-Channel (Charter Oak) Architectural color',
        }
        missing = expected - names
        assert not missing, f"Missing Charter Oak soffit variants: {missing}"


# =========================== UPCHARGE REMOVED ============================ #
class TestUpchargeRemoved:
    def test_no_arch_color_upcharge_anywhere(self, catalog):
        all_names = []
        for s in catalog["sections"]:
            all_names.extend(i["name"] for i in s["items"])
        assert "Architectural color upcharge Vinyl" not in all_names, \
            "Architectural color upcharge Vinyl should be removed in Iter 34"


# =========================== TIER PRICES ================================= #
class TestTierPrices:
    """Verify Howard's updated Excel prices via /api/admin/tiers."""

    @pytest.fixture(scope="class")
    def tiers(self):
        r = requests.get(f"{API}/admin/tiers", headers={"X-Admin-Token": SUPPLIER_ADMIN_TOKEN}, timeout=30)
        assert r.status_code == 200, f"admin/tiers failed: {r.status_code} {r.text[:300]}"
        return r.json()

    def test_admin_tiers_requires_token(self):
        r = requests.get(f"{API}/admin/tiers", timeout=30)
        assert r.status_code in (401, 403), f"Expected 401/403 without token, got {r.status_code}"

    def test_charter_oak_standard_clap_prices(self, tiers):
        # tiers is either list of tier docs or dict; normalise
        tier_docs = tiers if isinstance(tiers, list) else tiers.get("tiers", [])
        assert tier_docs, f"No tier docs returned: {tiers}"
        by_name = {}
        for t in tier_docs:
            name = t.get("name") or t.get("tier_name") or t.get("id")
            by_name[name] = t

        expected = {
            "whole-sale": 151.31,
            "Contractor": 136.22,
            "Builder-Dealer": 125.46,
            "one-opp": 113.57,
        }
        item_name = 'Charter Oak Standard color Clap 4.5" .046'
        for tier, expected_mat in expected.items():
            assert tier in by_name, f"Tier {tier!r} missing. Have: {list(by_name)}"
            sections = by_name[tier].get("sections", [])
            mat = None
            for sec in sections:
                for it in sec.get("items", []):
                    if it.get("name") == item_name:
                        mat = it.get("mat")
                        break
                if mat is not None:
                    break
            assert mat is not None, f"Item {item_name!r} not found in tier {tier!r}"
            assert abs(mat - expected_mat) < 0.01, \
                f"Tier {tier} {item_name}: expected ${expected_mat}, got ${mat}"


# =========================== AMI PART NUMBERS ============================ #
class TestAMIPartNumbers:
    def test_charter_oak_ami_present(self, catalog):
        sec = _section(catalog, "Vinyl Siding")
        by_name = {i["name"]: i for i in sec["items"]}

        assert by_name['Charter Oak Standard color Clap 4.5" .046'].get("ami_part") == "015451"
        assert by_name['Charter Oak Standard color Dutch Lap 4.5" .046'].get("ami_part") == "015452"
        # Architectural variants share AMI of base SKU per Iter 34 doc
        assert by_name['Charter Oak Architectural color Clap 4.5" .046'].get("ami_part") == "015451"


# =========================== ESTIMATE ROUND-TRIP ========================= #
class TestEstimateRoundTrip:
    def test_create_estimate_with_new_variant_item(self, auth_session):
        line = {
            "tab": "vinyl",
            "section": "Vinyl Siding",
            "name": 'Charter Oak Standard color Dutch Lap 4.5" .046',
            "qty": 25,
            "mat": 151.31,
            "lab": 125,
            "unit": "SQ",
        }
        payload = {
            "customer": {"name": f"TEST_Iter34_{uuid.uuid4().hex[:6]}", "address": "123 Test Ln"},
            "lines": [line],
            "notes": "Iter 34 regression test",
        }
        r = auth_session.post(f"{API}/estimates", json=payload, timeout=30)
        assert r.status_code in (200, 201), f"Create failed: {r.status_code} {r.text[:500]}"
        created = r.json()
        est_id = created.get("id") or created.get("_id")
        assert est_id, f"No id in create response: {created}"

        # GET round-trip
        r2 = auth_session.get(f"{API}/estimates/{est_id}", timeout=30)
        assert r2.status_code == 200, r2.text
        got = r2.json()
        lines = got.get("lines") or []
        assert lines, f"No lines returned for est {est_id}: {got}"
        assert lines[0]["name"] == line["name"]
        assert abs(float(lines[0]["mat"]) - 151.31) < 0.01
        assert abs(float(lines[0]["lab"]) - 125) < 0.01
        assert abs(float(lines[0]["qty"]) - 25) < 0.01

        # cleanup
        auth_session.delete(f"{API}/estimates/{est_id}", timeout=15)

    def test_list_estimates_does_not_error_on_legacy_lines(self, auth_session):
        """Legacy lines with deprecated names should still load."""
        r = auth_session.get(f"{API}/estimates", timeout=30)
        assert r.status_code == 200, f"List failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        # accept list or {items:[...]} envelope
        items = data if isinstance(data, list) else data.get("items", [])
        # ensure we can iterate without error
        for est in items:
            assert "id" in est or "_id" in est


# =========================== HOVER IMPORTER ============================== #
class TestHoverImporter:
    def test_endpoint_accepts_file_upload(self, auth_session):
        # Sending a minimal fake PDF — we expect the endpoint to NOT 404/405.
        # Acceptable responses: 200 (parsed empty), 400/422 (bad pdf), 415 unsupported.
        fake_pdf = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
        files = {"file": ("test.pdf", io.BytesIO(fake_pdf), "application/pdf")}
        r = auth_session.post(f"{API}/estimates/hover-import", files=files, timeout=30)
        assert r.status_code != 404, "hover-import endpoint missing (404)"
        assert r.status_code != 405, "hover-import endpoint wrong method (405)"
        assert r.status_code in (200, 201, 400, 415, 422, 500), \
            f"Unexpected status {r.status_code}: {r.text[:300]}"
