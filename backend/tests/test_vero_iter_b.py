"""Phase 4 Iter B backend tests for Vero — products_meta surface, catalog
sizing per product, casement sister colors, and Estimate round-trip with
the new vero_openings list. Complements test_vero_pricing.py (Iter A).
"""
import os
import uuid
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://app-converter-170.preview.emergentagent.com",
).rstrip("/")
ADMIN_TOKEN = os.environ.get("SUPPLIER_ADMIN_TOKEN", "test-admin-token")


def _login_howard_cookies() -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "hhunt6677@yahoo.com", "password": "Admin123!"},
        timeout=10,
    )
    r.raise_for_status()
    return {"access_token": r.cookies.get("access_token") or ""}


# ─────────── Admin matrix: products_meta + sizing per product ───────────
def test_admin_matrix_includes_products_meta_with_sizing():
    r = requests.get(f"{BASE_URL}/api/admin/vero/prices?token={ADMIN_TOKEN}", timeout=10)
    assert r.status_code == 200
    body = r.json()
    meta = body.get("products_meta") or {}
    # 6 products, each with a sizing key
    assert set(meta.keys()) == {
        "Vero Double Hung", "Vero 2-Lite Slider", "Vero 3-Lite Slider",
        "Vero Picture", "Vero Patio Door", "Vero 1-Lite Casement",
    }
    assert meta["Vero Double Hung"]["sizing"] == "ui_bucket"
    assert meta["Vero Patio Door"]["sizing"] == "fixed_model"
    assert meta["Vero 1-Lite Casement"]["sizing"] == "ui_bucket"
    # has_premium_options is True only for DH + Picture
    assert meta["Vero Double Hung"]["has_premium_options"] is True
    assert meta["Vero Picture"]["has_premium_options"] is True
    assert meta["Vero 3-Lite Slider"]["has_premium_options"] is False
    assert meta["Vero Patio Door"]["has_premium_options"] is False


# ─────────── Contractor catalog: Casement sister colors ───────────
def test_casement_has_three_sister_colors_including_laminate():
    r = requests.get(
        f"{BASE_URL}/api/vero/catalog", cookies=_login_howard_cookies(), timeout=10
    )
    assert r.status_code == 200
    pts = {p["name"]: p for p in r.json()["product_types"]}
    cas = pts["Vero 1-Lite Casement"]
    assert len(cas["sister_colors"]) == 3
    assert "Laminate Interior/White Exterior" in cas["sister_colors"]


# ─────────── Contractor catalog: Patio Door fixed-model layout ───────────
def test_patio_door_has_three_fixed_models():
    r = requests.get(
        f"{BASE_URL}/api/vero/catalog", cookies=_login_howard_cookies(), timeout=10
    )
    pts = {p["name"]: p for p in r.json()["product_types"]}
    patio = pts["Vero Patio Door"]
    assert patio["sizing"] == "fixed_model"
    # Model labels may include size suffixes like '5068 (58 3/8" x 79 1/2")'
    models = patio["models"]
    assert len(models) == 3
    prefixes = {m.split(" ")[0] for m in models}
    assert prefixes >= {"5068", "6068", "8068"}
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
