"""Iter 78z+ — Claude annotation hints + OCR auto-scale endpoint.

Validates the hint formatter math + the OCR endpoint's validation
paths. The actual Claude vision call for OCR is mocked at integration
level (cost) — we test the validation surface.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import requests
from routes.ai_measure import _build_annotation_hint

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "https://app.pro-quotes.com"
API = f"{BASE}/api"
ADMIN_EMAIL = "hhunt6677@yahoo.com"
ADMIN_PW = "Admin123!"


# ---------------------- Annotation hint formatter ----------------------

def test_hint_empty_when_no_annotations():
    assert _build_annotation_hint(None) == ""
    assert _build_annotation_hint({}) == ""


def test_hint_skips_reserved_scale_refs_key():
    """The `_scale_refs` key carries calibration data, not boxes."""
    annotations = {
        "_scale_refs": {"0": {"px_height": 220, "real_ft": 6.67}},
    }
    assert _build_annotation_hint(annotations) == ""


def test_hint_lists_each_box_with_profile_and_sqft():
    annotations = {
        "0": [
            {"elevation_label": "front", "profile": "shake",
             "sqft": 60, "callout": "front gable"},
            {"elevation_label": "porch", "profile": "board_batten", "sqft": 48},
        ],
    }
    hint = _build_annotation_hint(annotations)
    assert "SHAKE ≈ 60 ft²" in hint
    assert "BOARD BATTEN ≈ 48 ft²" in hint
    assert "front gable" in hint
    assert "porch" in hint
    # Front-matter header is present so Claude knows this is ground truth
    assert "GROUND-TRUTH ANNOTATIONS" in hint


def test_hint_surfaces_matching_pattern_reminder_for_accents():
    """Only NON-lap accents (Shake / B&B / Vertical / etc.) get the
    matching-pattern hint — lap is the default body and doesn't need it."""
    annotations = {
        "0": [
            {"elevation_label": "front", "profile": "shake", "sqft": 60},
            {"elevation_label": "back", "profile": "lap", "sqft": 800},
        ],
    }
    hint = _build_annotation_hint(annotations)
    assert "MATCHING PATTERN HINTS" in hint
    # The Shake hint should appear...
    assert "SHAKE appears on front" in hint
    # ...but lap should NOT trigger a matching-pattern reminder
    assert "LAP appears on" not in hint


def test_hint_zero_sqft_skipped():
    annotations = {
        "0": [
            {"elevation_label": "front", "profile": "shake", "sqft": 0},
            {"elevation_label": "front", "profile": "lap", "sqft": -5},
        ],
    }
    # Both are invalid → hint is empty
    assert _build_annotation_hint(annotations) == ""


def test_hint_missing_profile_skipped():
    annotations = {
        "0": [
            {"elevation_label": "front", "profile": "", "sqft": 60},
            {"elevation_label": "front", "sqft": 60},  # no profile key
        ],
    }
    assert _build_annotation_hint(annotations) == ""


def test_hint_includes_disclaimer_about_authoritative_application():
    """The hint must remind Claude that annotations land on the
    materials list regardless of what it returns — so it doesn't
    fight the user."""
    annotations = {
        "0": [{"elevation_label": "front", "profile": "shake", "sqft": 60}],
    }
    hint = _build_annotation_hint(annotations)
    assert "REGARDLESS" in hint


# ---------------------- OCR scale endpoint validation ----------------------

def _session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=10)
    assert r.status_code == 200
    return s


def test_ocr_400_on_missing_upload_name():
    s = _session()
    r = s.post(f"{API}/measure/ocr-scale", json={}, timeout=10)
    assert r.status_code == 400
    assert "upload_name" in r.text.lower()


def test_ocr_400_on_path_traversal_attempt():
    s = _session()
    r = s.post(f"{API}/measure/ocr-scale", json={"upload_name": "../../etc/passwd"}, timeout=10)
    assert r.status_code == 400


def test_ocr_404_on_nonexistent_upload():
    s = _session()
    r = s.post(f"{API}/measure/ocr-scale", json={"upload_name": "nope_does_not_exist.png"}, timeout=10)
    assert r.status_code == 404


def test_ocr_400_on_non_object_payload():
    s = _session()
    r = s.post(f"{API}/measure/ocr-scale", json=[1, 2, 3], timeout=10)
    # FastAPI might 422 the schema before our handler runs; accept either.
    assert r.status_code in (400, 422)


def test_ocr_unauthenticated():
    r = requests.post(f"{API}/measure/ocr-scale", json={"upload_name": "x.png"}, timeout=10)
    assert r.status_code in (401, 403)
