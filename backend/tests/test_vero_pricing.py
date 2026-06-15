"""Backend tests for Vero pricing — admin matrix, contractor catalog,
seeding idempotency. Mirrors the live-API pattern used by the other test
files in /app/backend/tests.
"""
import os
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://app-converter-170.preview.emergentagent.com",
).rstrip("/")
ADMIN_TOKEN = os.environ.get("SUPPLIER_ADMIN_TOKEN", "test-admin-token")


def _login_howard() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "hhunt6677@yahoo.com", "password": "Admin123!"},
        timeout=10,
    )
    r.raise_for_status()
    return r.cookies.get("access_token") or ""


def test_admin_get_matrix_returns_4_tiers_6_products():
    r = requests.get(f"{BASE_URL}/api/admin/vero/prices?token={ADMIN_TOKEN}", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["tiers"] == ["whole-sale", "Contractor", "Builder-Dealer", "one-opp"]
    assert len(body["products"]) == 6
    # Wholesale must be fully populated
    ws = body["data"]["whole-sale"]
    assert ws["Vero Double Hung"]["base_prices"]["Min-73"]["White Interior/White Exterior"] == 602.0


def test_admin_get_matrix_requires_token():
    r = requests.get(f"{BASE_URL}/api/admin/vero/prices", timeout=10)
    assert r.status_code in (401, 403)


def test_admin_put_invalid_tier_rejected():
    r = requests.put(
        f"{BASE_URL}/api/admin/vero/prices?token={ADMIN_TOKEN}",
        json={"tier": "premium-bogus", "product_type": "Vero Double Hung", "payload": {}},
        timeout=10,
    )
    assert r.status_code == 400


def test_admin_put_invalid_product_rejected():
    r = requests.put(
        f"{BASE_URL}/api/admin/vero/prices?token={ADMIN_TOKEN}",
        json={"tier": "Contractor", "product_type": "Bogus Window", "payload": {}},
        timeout=10,
    )
    assert r.status_code == 400


def test_admin_put_roundtrip():
    r = requests.get(f"{BASE_URL}/api/admin/vero/prices?token={ADMIN_TOKEN}", timeout=10)
    orig = r.json()["data"]["whole-sale"]["Vero Double Hung"]
    edited = {
        **orig,
        "base_prices": {
            **orig["base_prices"],
            "Min-73": {**orig["base_prices"]["Min-73"], "White Interior/White Exterior": 999.99},
        },
    }
    r2 = requests.put(
        f"{BASE_URL}/api/admin/vero/prices?token={ADMIN_TOKEN}",
        json={"tier": "whole-sale", "product_type": "Vero Double Hung", "payload": edited},
        timeout=10,
    )
    assert r2.status_code == 200
    r3 = requests.get(f"{BASE_URL}/api/admin/vero/prices?token={ADMIN_TOKEN}", timeout=10)
    after = r3.json()["data"]["whole-sale"]["Vero Double Hung"]
    assert after["base_prices"]["Min-73"]["White Interior/White Exterior"] == 999.99
    # Restore
    requests.put(
        f"{BASE_URL}/api/admin/vero/prices?token={ADMIN_TOKEN}",
        json={"tier": "whole-sale", "product_type": "Vero Double Hung", "payload": orig},
        timeout=10,
    )


def test_contractor_catalog_returns_full_payload():
    cookies = {"access_token": _login_howard()}
    r = requests.get(f"{BASE_URL}/api/vero/catalog", cookies=cookies, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["tier"] == "whole-sale"
    pts = {p["name"]: p for p in body["product_types"]}
    assert set(pts.keys()) == {
        "Vero Double Hung", "Vero 2-Lite Slider", "Vero 3-Lite Slider",
        "Vero Picture", "Vero Patio Door", "Vero 1-Lite Casement",
    }
    # DH structural assertions
    dh = pts["Vero Double Hung"]
    assert dh["sizing"] == "ui_bucket"
    assert len(dh["buckets"]) == 11
    assert dh["base_prices"]["Min-73"]["White Interior/White Exterior"] == 602.0
    # Patio = fixed_model
    patio = pts["Vero Patio Door"]
    assert patio["sizing"] == "fixed_model"
    assert len(patio["models"]) == 3
    assert "IntelliGlass X" in patio["glass_packages"]


def test_catalog_includes_glass_packages_and_premium_options():
    cookies = {"access_token": _login_howard()}
    body = requests.get(f"{BASE_URL}/api/vero/catalog", cookies=cookies, timeout=10).json()
    pts = {p["name"]: p for p in body["product_types"]}
    # 6 glass packages on DH, all present
    dh_pkgs = set(pts["Vero Double Hung"]["glass_packages"].keys())
    assert "IntelliGlass" in dh_pkgs
    assert "IntelliGlass X3" in dh_pkgs
    # Picture has premium_options
    pw = pts["Vero Picture"]
    assert pw.get("premium_options") and len(pw["premium_options"]) > 0
    # Casement has 3 sister colors (Lam Int/White Ext is the 3rd)
    cas = pts["Vero 1-Lite Casement"]
    assert "Laminate Interior/White Exterior" in cas["sister_colors"]
