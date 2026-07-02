"""Iter 79d — Tests for the async HOVER import launcher refactor.

Verifies:
- POST /api/estimates/hover-import returns {run_id, status, stage} (no measurements/lines)
- Non-PDF → 400
- >20MB PDF → 413
- GET /api/estimates/hover-import/status/{run_id} returns expected shape
- GET status for unknown run_id → 404
- Worker eventually flips status from running → done|error with result populated
"""
import io
import os
import time
import requests
import pytest
from reportlab.pdfgen import canvas

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app.pro-quotes.com").rstrip("/")
LOGIN_EMAIL = "hhunt6677@yahoo.com"
LOGIN_PASSWORD = "Admin123!"


@pytest.fixture(scope="module")
def auth_session():
    """Authenticated requests session with access_token cookie."""
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    # access_token cookie must be set as httpOnly
    cookies = s.cookies.get_dict()
    assert "access_token" in cookies or any(
        c.name == "access_token" for c in s.cookies
    ), f"access_token cookie not set. Cookies={cookies}"
    return s


@pytest.fixture(scope="module")
def small_pdf_bytes():
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(100, 750, "HOVER Report - Total siding 2400 sqft, soffit 320 sqft, fascia 180 lf")
    c.drawString(100, 720, "Front 600 sqft, Back 700 sqft, Left 550 sqft, Right 550 sqft")
    c.save()
    return buf.getvalue()


# --- Contract tests ---------------------------------------------------------

def test_post_hover_import_returns_async_shape(auth_session, small_pdf_bytes):
    """Critical: POST must return {run_id, status:'running', stage:'claude-mapping'}
    and NOT include legacy `lines` or `measurements` keys."""
    files = {"file": ("test.pdf", small_pdf_bytes, "application/pdf")}
    data = {"overhang_in": "12.0"}
    r = auth_session.post(
        f"{BASE_URL}/api/estimates/hover-import",
        files=files, data=data, timeout=30,
    )
    assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
    body = r.json()
    # Async-shape assertions
    assert "run_id" in body, f"Missing run_id in {body}"
    assert isinstance(body["run_id"], str) and len(body["run_id"]) > 0
    assert body.get("status") == "running", f"Expected status='running' got {body.get('status')}"
    assert body.get("stage") == "claude-mapping", f"Expected stage='claude-mapping' got {body.get('stage')}"
    assert "raw_extract_chars" in body and isinstance(body["raw_extract_chars"], int)
    # Critical: legacy sync shape must NOT be present in POST response
    assert "lines" not in body, "POST must not return 'lines' (sync legacy shape)"
    assert "measurements" not in body, "POST must not return 'measurements' (sync legacy shape)"
    # Stash for downstream test
    pytest.run_id = body["run_id"]


def test_post_hover_import_rejects_non_pdf(auth_session):
    files = {"file": ("notes.txt", b"this is just a text file", "text/plain")}
    r = auth_session.post(
        f"{BASE_URL}/api/estimates/hover-import",
        files=files, data={"overhang_in": "12.0"}, timeout=15,
    )
    assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"
    detail = r.json().get("detail", "")
    assert "pdf" in detail.lower(), f"Expected pdf detail, got: {detail}"


def test_post_hover_import_rejects_large_pdf(auth_session):
    # 20.5 MB blob with PDF filename to bypass extension check but trip size limit
    big = b"%PDF-1.4\n" + b"0" * (20 * 1024 * 1024 + 1024)
    files = {"file": ("huge.pdf", big, "application/pdf")}
    r = auth_session.post(
        f"{BASE_URL}/api/estimates/hover-import",
        files=files, data={"overhang_in": "12.0"}, timeout=60,
    )
    assert r.status_code == 413, f"Expected 413 got {r.status_code}: {r.text[:200]}"
    detail = r.json().get("detail", "")
    assert "too large" in detail.lower(), f"Expected 'too large' got: {detail}"


# --- Status endpoint tests --------------------------------------------------

def test_status_unknown_run_id_404(auth_session):
    r = auth_session.get(
        f"{BASE_URL}/api/estimates/hover-import/status/nonexistent_id_xyz_123",
        timeout=15,
    )
    assert r.status_code == 404, f"Expected 404 got {r.status_code}: {r.text}"
    assert "not found" in r.json().get("detail", "").lower()


def test_status_returns_expected_shape_running(auth_session, small_pdf_bytes):
    """Right after POST, GET status should return shape with status='running'."""
    files = {"file": ("test2.pdf", small_pdf_bytes, "application/pdf")}
    post_r = auth_session.post(
        f"{BASE_URL}/api/estimates/hover-import",
        files=files, data={"overhang_in": "12.0"}, timeout=30,
    )
    assert post_r.status_code == 200
    run_id = post_r.json()["run_id"]

    r = auth_session.get(
        f"{BASE_URL}/api/estimates/hover-import/status/{run_id}",
        timeout=15,
    )
    assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
    body = r.json()
    for k in ("run_id", "status", "stage", "result", "error", "elapsed_ms"):
        assert k in body, f"Missing key '{k}' in status response: {body}"
    assert body["run_id"] == run_id
    assert body["status"] in ("running", "done", "error")
    if body["status"] == "running":
        assert body["result"] is None
    assert isinstance(body["elapsed_ms"], int) and body["elapsed_ms"] >= 0


def test_status_eventually_done_or_error(auth_session, small_pdf_bytes):
    """Poll for up to 3 min; worker should terminate at 'done' or 'error'."""
    files = {"file": ("test3.pdf", small_pdf_bytes, "application/pdf")}
    post_r = auth_session.post(
        f"{BASE_URL}/api/estimates/hover-import",
        files=files, data={"overhang_in": "12.0"}, timeout=30,
    )
    assert post_r.status_code == 200
    run_id = post_r.json()["run_id"]

    deadline = time.time() + 180  # 3 min
    last_status = None
    last_stage = None
    seen_stages = set()
    while time.time() < deadline:
        r = auth_session.get(
            f"{BASE_URL}/api/estimates/hover-import/status/{run_id}",
            timeout=15,
        )
        assert r.status_code == 200, f"Status GET failed: {r.status_code}: {r.text}"
        body = r.json()
        last_status = body["status"]
        last_stage = body["stage"]
        if last_stage:
            seen_stages.add(last_stage)
        if last_status in ("done", "error"):
            break
        time.sleep(3)

    print(f"Final status={last_status} stage={last_stage} seen_stages={seen_stages}")
    assert last_status in ("done", "error"), \
        f"Worker did not terminate within 3 min. Last status={last_status} stage={last_stage}"

    # Fetch final state
    r = auth_session.get(
        f"{BASE_URL}/api/estimates/hover-import/status/{run_id}",
        timeout=15,
    )
    body = r.json()
    if body["status"] == "done":
        result = body.get("result")
        assert result is not None, "status=done but result is None"
        # Required fields per spec
        for key in ("measurements", "lines", "vero_openings", "mezzo_openings", "warnings", "deep_verify_cache_key"):
            assert key in result, f"Missing '{key}' in result. Keys present: {list(result.keys())}"
    elif body["status"] == "error":
        assert body.get("error"), "status=error but no error message"
        # Error is acceptable for a minimal PDF — Claude may legitimately fail to extract
        print(f"Worker errored (acceptable for minimal test PDF): {body.get('error')}")


def test_unauth_post_returns_401(small_pdf_bytes):
    """Sanity: no cookie → 401."""
    s = requests.Session()
    files = {"file": ("test.pdf", small_pdf_bytes, "application/pdf")}
    r = s.post(
        f"{BASE_URL}/api/estimates/hover-import",
        files=files, data={"overhang_in": "12.0"}, timeout=15,
    )
    assert r.status_code in (401, 403), f"Expected 401/403 got {r.status_code}"
