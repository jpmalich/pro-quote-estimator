"""Backend tests for Vero pricing — admin matrix, contractor catalog,
seeding idempotency. Mirrors the live-API pattern used by the other test
files in /app/backend/tests.

Iter 78y (2026-02-13): Vero collapsed per Howard's master pricing file.
  • 3 tiers (whole-sale / Contractor / Builder-Dealer); one-opp removed.
  • 3 product types (Vero Double Hung, Vero 2-Lite Slider, Vero Patio Door);
    3-Lite Slider / Picture / Casement dropped.
  • DH + 2-Lite Slider use single "0-101" UI bucket.
  • Prices computed via gross-margin formula from canonical cost basis in
    vero_catalog.py — wholesale 35%, Contractor 30%, Builder-Dealer 25%.
"""
import os
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://app.pro-quotes.com",
).rstrip("/")
ADMIN_TOKEN = os.environ.get("SUPPLIER_ADMIN_TOKEN", "test-admin-token")
ADMIN_HEADERS = {"X-Admin-Token": ADMIN_TOKEN}


def _login_howard() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "hhunt6677@yahoo.com", "password": "Admin123!"},
        timeout=10,
    )
    r.raise_for_status()
    return r.cookies.get("access_token") or ""


def test_admin_get_matrix_returns_3_tiers_3_products():
    r = requests.get(f"{BASE_URL}/api/admin/vero/prices", timeout=10, headers=ADMIN_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["tiers"] == ["whole-sale", "Contractor", "Builder-Dealer"]
    assert set(body["products"]) == {
        "Vero Double Hung", "Vero 2-Lite Slider", "Vero Patio Door",
    }
    # Wholesale = $186.92 cost / (1 - 0.35) = $287.57
    ws = body["data"]["whole-sale"]
    dh_price = ws["Vero Double Hung"]["base_prices"]["0-101"]["White Interior/White Exterior"]
    assert abs(dh_price - 287.57) < 0.05


def test_admin_get_matrix_requires_token():
    r = requests.get(f"{BASE_URL}/api/admin/vero/prices", timeout=10, headers=ADMIN_HEADERS)
    assert r.status_code in (401, 403)


def test_admin_put_invalid_tier_rejected():
    r = requests.put(
        f"{BASE_URL}/api/admin/vero/prices",
        json={"tier": "premium-bogus", "product_type": "Vero Double Hung", "payload": {}},
        timeout=10,
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 400


def test_admin_put_invalid_product_rejected():
    r = requests.put(
        f"{BASE_URL}/api/admin/vero/prices",
        json={"tier": "Contractor", "product_type": "Bogus Window", "payload": {}},
        timeout=10,
        headers=ADMIN_HEADERS,
    )
    assert r.status_code == 400


def test_admin_put_roundtrip():
    r = requests.get(f"{BASE_URL}/api/admin/vero/prices", timeout=10, headers=ADMIN_HEADERS)
    orig = r.json()["data"]["whole-sale"]["Vero Double Hung"]
    edited = {
        **orig,
        "base_prices": {
            **orig["base_prices"],
            "0-101": {**orig["base_prices"]["0-101"], "White Interior/White Exterior": 999.99},
        },
    }
    r2 = requests.put(
        f"{BASE_URL}/api/admin/vero/prices",
        json={"tier": "whole-sale", "product_type": "Vero Double Hung", "payload": edited},
        timeout=10,
        headers=ADMIN_HEADERS,
    )
    assert r2.status_code == 200
    r3 = requests.get(f"{BASE_URL}/api/admin/vero/prices", timeout=10, headers=ADMIN_HEADERS)
    after = r3.json()["data"]["whole-sale"]["Vero Double Hung"]
    assert after["base_prices"]["0-101"]["White Interior/White Exterior"] == 999.99
    # Restore
    requests.put(
        f"{BASE_URL}/api/admin/vero/prices",
        json={"tier": "whole-sale", "product_type": "Vero Double Hung", "payload": orig},
        timeout=10,
        headers=ADMIN_HEADERS,
    )


def test_contractor_catalog_returns_full_payload():
    cookies = {"access_token": _login_howard()}
    r = requests.get(f"{BASE_URL}/api/vero/catalog", cookies=cookies, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["tier"] in ("whole-sale", "Contractor", "Builder-Dealer")
    pts = {p["name"]: p for p in body["product_types"]}
    assert set(pts.keys()) == {
        "Vero Double Hung", "Vero 2-Lite Slider", "Vero Patio Door",
    }
    # DH: single bucket, single sister color
    dh = pts["Vero Double Hung"]
    assert dh["sizing"] == "ui_bucket"
    # buckets may be either strings or {label, min, max} objects
    bucket_labels = [b if isinstance(b, str) else b.get("label") for b in dh["buckets"]]
    assert bucket_labels == ["0-101"]
    assert dh["base_prices"]["0-101"] > 0
    # Patio = fixed_model with 3 panel sizes
    patio = pts["Vero Patio Door"]
    assert patio["sizing"] == "fixed_model"
    assert len(patio["models"]) == 3


def test_dh_and_slider_have_8_iter_78y_adders():
    cookies = {"access_token": _login_howard()}
    body = requests.get(f"{BASE_URL}/api/vero/catalog", cookies=cookies, timeout=10).json()
    pts = {p["name"]: p for p in body["product_types"]}
    expected_adders = {
        "Quattro .25 U Factor 2 coats LoE",
        "Elite TG2 .24 U Factor 1 coat",
        "TG2 Triple Pane/Argon .19 U Factor",
        "Head Expander 0-101",
        "Grids",
        "Sentry System - Tilt Lock upgrade",
        "Integral Nail Fin 0-101",
        "Heavy Duty 1/2 Screen White ONLY",
    }
    for pt_name in ("Vero Double Hung", "Vero 2-Lite Slider"):
        # Contractor catalog returns `adders` as a list of dicts, each with `name`.
        adders = {a["name"] for a in pts[pt_name].get("adders", [])}
        assert adders == expected_adders, f"{pt_name} adders drift: got {adders}"
