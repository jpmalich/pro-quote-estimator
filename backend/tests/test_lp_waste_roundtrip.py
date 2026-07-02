"""Iter 78a regression — LP SmartSide raw_qty round-trip.

Verifies the backend correctly persists & returns the `raw_qty` field on
EstimateLine for LP estimates so the frontend's recomputeWasteQtys() can
re-apply the waste % when the contractor changes it later.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app.pro-quotes.com").rstrip("/")
ADMIN_EMAIL = "hhunt6677@yahoo.com"
ADMIN_PASS = "Admin123!"


@pytest.fixture(scope="module")
def auth_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def lp_estimate(auth_session):
    """Create an LP SmartSide estimate with waste_pct=20."""
    payload = {
        "kind": "lp_smart",
        "cust_name": "TEST_LP_RawQty",
        "cust_address": "123 LP Lane",
        "estimator": "Howard",
        "waste_pct": 20,
        "lines": [],
    }
    r = auth_session.post(f"{BASE_URL}/api/estimates", json=payload, timeout=20)
    assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text}"
    est = r.json()
    assert est.get("kind") == "lp_smart"
    assert est.get("waste_pct") == 20
    # Field should default to 'mix'
    assert est.get("lp_soffit_type", "mix") == "mix"
    yield est
    # Teardown
    try:
        auth_session.delete(f"{BASE_URL}/api/estimates/{est['id']}", timeout=10)
    except Exception:
        pass


def test_lp_kind_persisted(lp_estimate):
    assert lp_estimate["kind"] == "lp_smart"


def test_lp_soffit_type_default_mix(lp_estimate):
    assert lp_estimate.get("lp_soffit_type", "mix") == "mix"


def test_raw_qty_roundtrip(auth_session, lp_estimate):
    """PUT a line with raw_qty=198, qty=238 (LP 38 Series Lap baked with 20% waste).
    GET back and assert both fields preserved."""
    eid = lp_estimate["id"]
    line = {
        "section": "LP Smart Siding",
        "name": "38 Series Lap 3/8\" x 8\" x 16'",
        "unit": "PCS",
        "qty": 238,
        "raw_qty": 198,
        "mat": 0,
        "lab": 0,
        "tab": "lp_smart",
    }
    # Send minimum payload — PUT needs full estimate object
    put_payload = {**lp_estimate, "lines": [line]}
    # Strip out fields the backend may set itself
    put_payload.pop("id", None)
    put_payload.pop("created_at", None)
    put_payload.pop("updated_at", None)
    put_payload.pop("estimate_number", None)
    r = auth_session.put(f"{BASE_URL}/api/estimates/{eid}", json=put_payload, timeout=20)
    assert r.status_code == 200, f"PUT failed: {r.status_code} {r.text}"

    # GET back
    g = auth_session.get(f"{BASE_URL}/api/estimates/{eid}", timeout=20)
    assert g.status_code == 200
    fetched = g.json()
    lines = fetched.get("lines", [])
    assert len(lines) == 1, f"expected 1 line, got {len(lines)}"
    L = lines[0]
    assert L["name"].startswith("38 Series Lap"), f"name mismatch: {L.get('name')}"
    assert L["qty"] == 238, f"qty drift: expected 238, got {L.get('qty')}"
    assert L.get("raw_qty") == 198, f"raw_qty NOT round-tripped: expected 198, got {L.get('raw_qty')}"
    assert L.get("tab") == "lp_smart"
    assert L.get("section") == "LP Smart Siding"


def test_raw_qty_optional_omitted(auth_session, lp_estimate):
    """A line WITHOUT raw_qty (manual edit) should still round-trip cleanly,
    with raw_qty either absent or None — confirming manual-edit qtys won't
    be recomputed by frontend recomputeWasteQtys()."""
    eid = lp_estimate["id"]
    line = {
        "section": "LP Smart Siding",
        "name": "38 Series Lap 3/8\" x 8\" x 16'",
        "unit": "PCS",
        "qty": 100,  # manually entered
        "mat": 0,
        "lab": 0,
        "tab": "lp_smart",
    }
    put_payload = {**lp_estimate, "lines": [line]}
    put_payload.pop("id", None)
    put_payload.pop("created_at", None)
    put_payload.pop("updated_at", None)
    put_payload.pop("estimate_number", None)
    r = auth_session.put(f"{BASE_URL}/api/estimates/{eid}", json=put_payload, timeout=20)
    assert r.status_code == 200

    g = auth_session.get(f"{BASE_URL}/api/estimates/{eid}", timeout=20)
    assert g.status_code == 200
    fetched = g.json()
    L = fetched["lines"][0]
    assert L["qty"] == 100
    # raw_qty should be None or missing — NOT auto-populated
    assert L.get("raw_qty") in (None, 0) or "raw_qty" not in L, f"unexpected raw_qty: {L.get('raw_qty')}"
