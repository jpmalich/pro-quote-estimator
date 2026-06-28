"""Phase 3 — Mezzo Pricing Matrix admin + catalog tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app-converter-170.preview.emergentagent.com").rstrip("/")
ADMIN_TOKEN = os.environ.get("SUPPLIER_ADMIN_TOKEN", "test-admin-token")
ADMIN_HEADERS = {"X-Admin-Token": ADMIN_TOKEN}
LOGIN_EMAIL = "hhunt6677@yahoo.com"
LOGIN_PASSWORD = "Admin123!"

TIERS = ["whole-sale", "Contractor", "Builder-Dealer", "one-opp"]
PRODUCTS = ["Mezzo Double Hung", "Mezzo 2-Lite Slider", "Mezzo 3-Lite Slider", "Mezzo Picture"]


# ─────────── Admin GET /api/admin/mezzo/prices ───────────
class TestAdminMezzoGet:
    def test_get_with_valid_token_returns_full_matrix(self):
        r = requests.get(f"{BASE_URL}/api/admin/mezzo/prices", headers=ADMIN_HEADERS)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["tiers"] == TIERS
        assert set(body["products"]) == set(PRODUCTS)
        assert len(body["data"]) == 4
        for t in TIERS:
            assert t in body["data"]
            for p in PRODUCTS:
                assert p in body["data"][t]
                grid = body["data"][t][p]
                assert "base_prices" in grid
                assert "adder_prices" in grid
        # Sample whole-sale DH 32-73 UI = 259.608
        assert body["data"]["whole-sale"]["Mezzo Double Hung"]["base_prices"]["32-73 UI"] == pytest.approx(259.608, rel=1e-4)
        # Buckets/adders shape present
        assert "buckets" in body and "adders" in body
        assert len(body["buckets"]["Mezzo Double Hung"]) == 13

    def test_get_without_token_forbidden(self):
        r = requests.get(f"{BASE_URL}/api/admin/mezzo/prices")
        assert r.status_code in (401, 403), r.text


# ─────────── Admin PUT /api/admin/mezzo/prices ───────────
class TestAdminMezzoPut:
    def test_put_round_trip_and_restore(self):
        # Read original
        r = requests.get(f"{BASE_URL}/api/admin/mezzo/prices", headers=ADMIN_HEADERS)
        assert r.status_code == 200
        orig = r.json()["data"]["whole-sale"]["Mezzo Double Hung"]
        original_base = dict(orig["base_prices"])
        original_adders = {k: dict(v) for k, v in orig["adder_prices"].items()}

        # Mutate one cell
        mutated_base = dict(original_base)
        mutated_base["32-73 UI"] = 999.99
        body = {
            "tier": "whole-sale",
            "product_type": "Mezzo Double Hung",
            "base_prices": mutated_base,
            "adder_prices": original_adders,
        }
        put = requests.put(
            f"{BASE_URL}/api/admin/mezzo/prices",
            json=body,
            headers=ADMIN_HEADERS,
        )
        assert put.status_code == 200, put.text
        saved = put.json()
        assert saved["base_prices"]["32-73 UI"] == pytest.approx(999.99)

        # Read back
        r2 = requests.get(f"{BASE_URL}/api/admin/mezzo/prices", headers=ADMIN_HEADERS)
        assert r2.json()["data"]["whole-sale"]["Mezzo Double Hung"]["base_prices"]["32-73 UI"] == pytest.approx(999.99)

        # Restore
        restore_body = {
            "tier": "whole-sale",
            "product_type": "Mezzo Double Hung",
            "base_prices": original_base,
            "adder_prices": original_adders,
        }
        put2 = requests.put(
            f"{BASE_URL}/api/admin/mezzo/prices",
            json=restore_body,
            headers=ADMIN_HEADERS,
        )
        assert put2.status_code == 200
        r3 = requests.get(f"{BASE_URL}/api/admin/mezzo/prices", headers=ADMIN_HEADERS)
        assert r3.json()["data"]["whole-sale"]["Mezzo Double Hung"]["base_prices"]["32-73 UI"] == pytest.approx(259.608, rel=1e-4)

    def test_put_invalid_tier_400(self):
        r = requests.put(
            f"{BASE_URL}/api/admin/mezzo/prices",
            json={
                "tier": "bogus-tier",
                "product_type": "Mezzo Double Hung",
                "base_prices": {},
                "adder_prices": {},
            },
            headers=ADMIN_HEADERS,
        )
        assert r.status_code == 400, r.text

    def test_put_invalid_product_400(self):
        r = requests.put(
            f"{BASE_URL}/api/admin/mezzo/prices",
            json={
                "tier": "whole-sale",
                "product_type": "Mezzo Nonexistent",
                "base_prices": {},
                "adder_prices": {},
            },
            headers=ADMIN_HEADERS,
        )
        assert r.status_code == 400, r.text


# ─────────── Contractor /api/mezzo/catalog ───────────
@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"login failed: {r.status_code} {r.text}")
    token = r.json().get("access_token") or r.json().get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


class TestMezzoCatalog:
    def test_catalog_returns_real_prices(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/mezzo/catalog")
        assert r.status_code == 200, r.text
        cat = r.json()
        assert "product_types" in cat
        pts = cat["product_types"]
        assert len(pts) == 4
        names = {p["name"] for p in pts}
        assert names == set(PRODUCTS)
        dh = next(p for p in pts if p["name"] == "Mezzo Double Hung")
        # whole-sale tier base DH 32-73 UI = 259.608
        assert dh["base_prices"]["32-73 UI"] == pytest.approx(259.608, rel=1e-4)
        # Tempered Full adder kind=sqft rate=9.18
        tf = next(a for a in dh["adders"] if a["name"] == "Tempered Full")
        assert tf["kind"] == "sqft"
        assert tf["rate"] == pytest.approx(9.18)

    def test_catalog_has_nonzero_prices(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/mezzo/catalog")
        cat = r.json()
        # Ensure prices are NOT all zeros (regression for phase 3 seeding)
        any_nonzero = False
        for p in cat["product_types"]:
            for v in p["base_prices"].values():
                if float(v) > 0:
                    any_nonzero = True
                    break
        assert any_nonzero, "All base prices are zero — Mongo seeding likely failed"


# ─────────── Idempotent seeding ───────────
class TestMezzoSeedIdempotent:
    def test_seed_twice_no_duplicates(self):
        import asyncio
        import sys
        sys.path.insert(0, "/app/backend")
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        import mezzo_prices
        from db import db

        async def runner():
            await mezzo_prices.seed_mezzo_prices()
            await mezzo_prices.seed_mezzo_prices()
            return await db.mezzo_prices.count_documents({})

        count = asyncio.run(runner())
        assert count == 16, f"Expected 16 mezzo_prices docs, got {count}"
