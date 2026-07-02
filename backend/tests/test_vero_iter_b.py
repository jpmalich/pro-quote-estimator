"""Phase 4 Iter B backend tests for Vero — products_meta surface, catalog
sizing per product, casement sister colors, and Estimate round-trip with
the new vero_openings list. Complements test_vero_pricing.py (Iter A).
"""
import os
import uuid
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://app.pro-quotes.com",
).rstrip("/")
ADMIN_TOKEN = os.environ.get("SUPPLIER_ADMIN_TOKEN", "test-admin-token")
ADMIN_HEADERS = {"X-Admin-Token": ADMIN_TOKEN}


def _login_howard_cookies() -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "hhunt6677@yahoo.com", "password": "Admin123!"},
        timeout=10,
    )
    r.raise_for_status()
    return {"access_token": r.cookies.get("access_token") or ""}


# ─────────── Admin matrix: products_meta + sizing per product ───────────
# Iter 78y (2026-02-13): collapsed to 3 product types (DH, 2-Lite Slider,
# Patio Door). 3-Lite Slider / Picture / Casement dropped per Howard.
def test_admin_matrix_includes_products_meta_with_sizing():
    r = requests.get(f"{BASE_URL}/api/admin/vero/prices", timeout=10, headers=ADMIN_HEADERS)
    assert r.status_code == 200
    body = r.json()
    meta = body.get("products_meta") or {}
    assert set(meta.keys()) == {
        "Vero Double Hung", "Vero 2-Lite Slider", "Vero Patio Door",
    }
    assert meta["Vero Double Hung"]["sizing"] == "ui_bucket"
    assert meta["Vero 2-Lite Slider"]["sizing"] == "ui_bucket"
    assert meta["Vero Patio Door"]["sizing"] == "fixed_model"


# ─────────── Contractor catalog: Patio Door fixed-model layout ───────────
def test_patio_door_has_three_fixed_models():
    r = requests.get(
        f"{BASE_URL}/api/vero/catalog", cookies=_login_howard_cookies(), timeout=10
    )
    pts = {p["name"]: p for p in r.json()["product_types"]}
    patio = pts["Vero Patio Door"]
    assert patio["sizing"] == "fixed_model"
    # Iter 78y — model labels now include the 4792PD prefix + size suffix
    # (e.g. "4792PD 2 Panel 5068 (58 3/4\" x 79 1/2\")").
    models = patio["models"]
    assert len(models) == 3
    # Each model contains the panel size code (5068 / 6068 / 8068)
    sizes_in_models = {code for code in ("5068", "6068", "8068")
                       if any(code in m for m in models)}
    assert sizes_in_models == {"5068", "6068", "8068"}
    # Patio uses patio_prices not base_prices
    assert "patio_prices" in patio


# ─────────── Estimate round-trip: vero_openings list ───────────
def test_estimate_roundtrips_vero_openings():
    cookies = _login_howard_cookies()
    # Create a windows-kind estimate
    create = requests.post(
        f"{BASE_URL}/api/estimates",
        json={"kind": "windows", "customer_name": "TEST_VeroOpening"},
        cookies=cookies, timeout=10,
    )
    assert create.status_code in (200, 201)
    est = create.json()
    est_id = est["id"]
    try:
        # Build a UI-bucket DH opening + a fixed-model Patio opening
        dh = {
            "id": str(uuid.uuid4()),
            "product_type": "Vero Double Hung",
            "sizing": "ui_bucket",
            "label": "Kitchen",
            "width": 36, "height": 60, "qty": 1,
            "sister_color": "Tan Interior/Tan Exterior",
            "glass_package": "IntelliGlass X",
            "tempered_upcharge": "Clear Tempered",
            "premium_options": [],
            "bucket_label": "94-101",
            "base_mat": 662.20,
            "glass_mat": 77.0,
            "tempered_mat": 439.0,
            "premium_mat": 0.0,
        }
        patio = {
            "id": str(uuid.uuid4()),
            "product_type": "Vero Patio Door",
            "sizing": "fixed_model",
            "label": "Back Patio",
            "model": "6068", "qty": 1,
            "sister_color": "White Interior/White Exterior",
            "glass_package": "IntelliGlass X",
            "tempered_upcharge": "",
            "premium_options": [],
            "bucket_label": "",
            "base_mat": 2513.0,
            "glass_mat": 0.0,
            "tempered_mat": 0.0,
            "premium_mat": 0.0,
        }
        payload = {**est, "vero_openings": [dh, patio]}
        # Strip server-managed fields
        for k in ("_id", "created_at", "updated_at", "totals"):
            payload.pop(k, None)
        put = requests.put(
            f"{BASE_URL}/api/estimates/{est_id}", json=payload, cookies=cookies, timeout=10,
        )
        assert put.status_code == 200, put.text
        # GET back and verify
        got = requests.get(
            f"{BASE_URL}/api/estimates/{est_id}", cookies=cookies, timeout=10
        ).json()
        openings = got.get("vero_openings") or []
        assert len(openings) == 2
        by_pt = {o["product_type"]: o for o in openings}
        assert by_pt["Vero Double Hung"]["sister_color"] == "Tan Interior/Tan Exterior"
        assert by_pt["Vero Double Hung"]["bucket_label"] == "94-101"
        assert by_pt["Vero Double Hung"]["base_mat"] == 662.20
        assert by_pt["Vero Double Hung"]["glass_mat"] == 77.0
        assert by_pt["Vero Double Hung"]["tempered_mat"] == 439.0
        assert by_pt["Vero Patio Door"]["model"] == "6068"
        assert by_pt["Vero Patio Door"]["base_mat"] == 2513.0
        # Totals: DH per-window = 662.2 + 77 + 439 = 1178.2; Patio = 2513
        # sub_mat should contain at least 1178.2 + 2513 = 3691.2
        totals = got.get("totals") or {}
        if totals:
            assert totals.get("sub_mat", 0) >= 3691.0
    finally:
        requests.delete(f"{BASE_URL}/api/estimates/{est_id}", cookies=cookies, timeout=10)
