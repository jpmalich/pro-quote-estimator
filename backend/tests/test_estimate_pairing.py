"""Iter 41: Tests for cross-kind estimate pairing.

Covers:
  - POST /api/estimates/{id}/pair auth + 404 handling
  - Siding -> Windows pairing (EST-XXX -> EST-XXX-W) + copy of customer info
  - Idempotency (calling /pair twice returns same paired doc)
  - Windows -> Siding pairing (no suffix -> EST-XXX-S)
  - Windows-with-W-suffix -> Siding (strips -W)
  - GET /api/estimates?kind=siding surfaces paired_estimate_number + paired_estimate_kind
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app-converter-170.preview.emergentagent.com").rstrip("/")
EMAIL = "hhunt6677@yahoo.com"
PASSWORD = "Admin123!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    yield s
    # Cleanup any TEST_ prefix estimates we created
    r = s.get(f"{BASE_URL}/api/estimates")
    if r.status_code == 200:
        for e in r.json():
            num = (e.get("estimate_number") or "")
            cust = (e.get("customer_name") or "")
            if num.startswith("EST-PAIR") or "PAIR_TEST_" in cust or cust.startswith("Pair Smoke"):
                try:
                    s.delete(f"{BASE_URL}/api/estimates/{e['id']}")
                except Exception:
                    pass
        # also windows kind
        r2 = s.get(f"{BASE_URL}/api/estimates?kind=windows")
        if r2.status_code == 200:
            for e in r2.json():
                num = (e.get("estimate_number") or "")
                cust = (e.get("customer_name") or "")
                if num.startswith("EST-PAIR") or "PAIR_TEST_" in cust or cust.startswith("Pair Smoke"):
                    try:
                        s.delete(f"{BASE_URL}/api/estimates/{e['id']}")
                    except Exception:
                        pass


def _unique(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:6].upper()}"


# Test 1: Auth + 404
def test_pair_requires_auth():
    r = requests.post(f"{BASE_URL}/api/estimates/anything/pair")
    assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


def test_pair_non_existent_returns_404(session):
    fake_id = str(uuid.uuid4())
    r = session.post(f"{BASE_URL}/api/estimates/{fake_id}/pair")
    assert r.status_code == 404


# Test 2: Siding -> Windows
def test_siding_to_windows_pair_and_idempotency(session):
    num = _unique("EST-PAIR1")
    r = session.post(f"{BASE_URL}/api/estimates", json={
        "estimate_number": num,
        "customer_name": "PAIR_TEST_Smith",
        "address": "123 Test Lane",
        "estimator": "Howard",
        "kind": "siding",
    })
    assert r.status_code == 200, r.text
    src = r.json()
    src_id = src["id"]

    r = session.post(f"{BASE_URL}/api/estimates/{src_id}/pair")
    assert r.status_code == 200, r.text
    paired = r.json()
    assert paired["kind"] == "windows"
    assert paired["estimate_number"] == f"{num}-W"
    assert paired["customer_name"] == "PAIR_TEST_Smith"
    assert paired["address"] == "123 Test Lane"
    assert paired["estimator"] == "Howard"
    assert paired["paired_estimate_id"] == src_id
    paired_id = paired["id"]

    # Re-fetch source: should have back-pointer
    r = session.get(f"{BASE_URL}/api/estimates/{src_id}")
    assert r.status_code == 200
    src_refetch = r.json()
    assert src_refetch.get("paired_estimate_id") == paired_id

    # Idempotency
    r = session.post(f"{BASE_URL}/api/estimates/{src_id}/pair")
    assert r.status_code == 200
    again = r.json()
    assert again["id"] == paired_id, "Idempotency violated — created a new doc"

    # Save IDs for cross-test cleanup awareness
    return src_id, paired_id


# Test 3a: Windows (no suffix) -> Siding (-S)
def test_windows_no_suffix_pair_creates_S(session):
    num = _unique("EST-PAIR2")
    r = session.post(f"{BASE_URL}/api/estimates", json={
        "estimate_number": num,
        "customer_name": "PAIR_TEST_Jones",
        "kind": "windows",
    })
    assert r.status_code == 200
    src = r.json()
    r = session.post(f"{BASE_URL}/api/estimates/{src['id']}/pair")
    assert r.status_code == 200, r.text
    paired = r.json()
    assert paired["kind"] == "siding"
    assert paired["estimate_number"] == f"{num}-S"


# Test 3b: Windows (with -W suffix) -> Siding strips suffix
def test_windows_with_W_suffix_strips(session):
    base = _unique("EST-PAIR3")
    num = f"{base}-W"
    r = session.post(f"{BASE_URL}/api/estimates", json={
        "estimate_number": num,
        "customer_name": "PAIR_TEST_Brown",
        "kind": "windows",
    })
    assert r.status_code == 200
    src = r.json()
    r = session.post(f"{BASE_URL}/api/estimates/{src['id']}/pair")
    assert r.status_code == 200, r.text
    paired = r.json()
    assert paired["kind"] == "siding"
    assert paired["estimate_number"] == base, f"expected {base}, got {paired['estimate_number']}"


# Test 4: list endpoint exposes paired_estimate_number + paired_estimate_kind
def test_list_estimates_includes_paired_metadata(session):
    num = _unique("EST-PAIR1B")
    r = session.post(f"{BASE_URL}/api/estimates", json={
        "estimate_number": num,
        "customer_name": "PAIR_TEST_List",
        "kind": "siding",
    })
    assert r.status_code == 200
    src = r.json()
    r = session.post(f"{BASE_URL}/api/estimates/{src['id']}/pair")
    assert r.status_code == 200
    paired = r.json()

    r = session.get(f"{BASE_URL}/api/estimates?kind=siding")
    assert r.status_code == 200
    rows = r.json()
    found = next((e for e in rows if e["id"] == src["id"]), None)
    assert found is not None
    assert found.get("paired_estimate_number") == f"{num}-W"
    assert found.get("paired_estimate_kind") == "windows"
    # And reverse
    r = session.get(f"{BASE_URL}/api/estimates?kind=windows")
    assert r.status_code == 200
    rows = r.json()
    found = next((e for e in rows if e["id"] == paired["id"]), None)
    assert found is not None
    assert found.get("paired_estimate_number") == num
    assert found.get("paired_estimate_kind") == "siding"
