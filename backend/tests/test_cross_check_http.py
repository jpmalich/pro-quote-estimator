"""Iter 78z (Cross-Check) HTTP endpoint validation tests.

Hits the live FastAPI server through the public preview URL. These tests
verify the cheap validation paths only (404, 403, 409, 400 — no Claude
call). We seed fake `ai_measure_runs` docs straight into Mongo via motor
to avoid running a real (expensive) primary AI Measure pass.

Also covers the /api/measure/map regression — that an `_ai_profile_recheck`
key on a measurements dict does not break the catalog mapper.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Frontend public URL — what the user actually sees
BASE_URL = "https://app-converter-170.preview.emergentagent.com"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "hhunt6677@yahoo.com"
ADMIN_PASSWORD = "Admin123!"

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    me = s.get(f"{API}/auth/me", timeout=10)
    assert me.status_code == 200
    user_id = me.json().get("id")
    assert user_id, f"No id on /auth/me: {me.text}"
    s._user_id = user_id  # stash
    yield s


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    yield db
    client.close()


# Helper to insert a fake run doc
def _insert_run(db, **overrides):
    run_id = overrides.pop("run_id", uuid.uuid4().hex)
    doc = {
        "run_id": run_id,
        "user_id": overrides.pop("user_id", "anon"),
        "status": overrides.pop("status", "done"),
        "photo_paths": overrides.pop("photo_paths", ""),
        "result": overrides.pop("result", {"measurements": {}}),
        **overrides,
    }
    db.ai_measure_runs.insert_one(doc)
    return run_id


def _delete_run(db, run_id):
    db.ai_measure_runs.delete_one({"run_id": run_id})


# ---------------- tests ----------------
class TestCrossCheckEndpointValidation:
    """Cheap validation paths — no Claude call."""

    def test_404_when_run_id_unknown(self, admin_session):
        r = admin_session.post(f"{API}/measure/ai-cross-check/does-not-exist-zzz", timeout=15)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"
        assert r.json().get("detail") == "Run not found"

    def test_403_when_run_belongs_to_another_user(self, admin_session, mongo_db):
        run_id = _insert_run(
            mongo_db,
            user_id="some-other-user-id-xyz",
            status="done",
            photo_paths="x.jpg",
        )
        try:
            r = admin_session.post(f"{API}/measure/ai-cross-check/{run_id}", timeout=15)
            assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
            assert r.json().get("detail") == "Not your run"
        finally:
            _delete_run(mongo_db, run_id)

    def test_409_when_primary_run_not_done(self, admin_session, mongo_db):
        run_id = _insert_run(
            mongo_db,
            user_id=admin_session._user_id,
            status="running",
            photo_paths="x.jpg",
        )
        try:
            r = admin_session.post(f"{API}/measure/ai-cross-check/{run_id}", timeout=15)
            assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text}"
            assert "not complete" in (r.json().get("detail") or "").lower()
        finally:
            _delete_run(mongo_db, run_id)

    def test_403_when_run_is_anonymous_no_longer_allowlisted(self, admin_session, mongo_db):
        """SEC-007 — Iter 78z++++: 'anon' is no longer an authorized owner.
        Runs with user_id='anon' must 403 (used to fall through to 409)."""
        run_id = _insert_run(
            mongo_db,
            user_id="anon",
            status="error",
            photo_paths="x.jpg",
        )
        try:
            r = admin_session.post(f"{API}/measure/ai-cross-check/{run_id}", timeout=15)
            assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        finally:
            _delete_run(mongo_db, run_id)

    def test_400_when_done_run_has_no_photo_paths(self, admin_session, mongo_db):
        """status=done, owner matches, but photo_paths empty → 400."""
        run_id = _insert_run(
            mongo_db,
            user_id=admin_session._user_id,
            status="done",
            photo_paths="",  # empty!
        )
        try:
            r = admin_session.post(f"{API}/measure/ai-cross-check/{run_id}", timeout=15)
            assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
            assert "photos" in (r.json().get("detail") or "").lower()
        finally:
            _delete_run(mongo_db, run_id)

    def test_400_when_cached_photos_missing_from_disk(self, admin_session, mongo_db):
        """photo_paths populated but the files don't exist on disk → 400."""
        run_id = _insert_run(
            mongo_db,
            user_id=admin_session._user_id,
            status="done",
            photo_paths="ghost-photo-does-not-exist-123.jpg",
        )
        try:
            r = admin_session.post(f"{API}/measure/ai-cross-check/{run_id}", timeout=15)
            assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
            assert "disk" in (r.json().get("detail") or "").lower() or \
                   "re-upload" in (r.json().get("detail") or "").lower()
        finally:
            _delete_run(mongo_db, run_id)


class TestMeasureMapRegressionWithRecheckField:
    """Confirm the catalog mapper still works when measurements contain
    the new `_ai_profile_recheck` field that the cross-check writes."""

    def test_map_with_recheck_field_succeeds(self, admin_session):
        payload = {
            "measurements": {
                "_per_profile_sqft": {
                    "lap": 1200,
                    "shake": 200,
                },
                "_per_elevation_breakdown": [
                    {"label": "front", "wall_body_profile": "lap",
                     "gable_profile": "", "dormer_profile": "", "accents": []},
                ],
                "_ai_profile_recheck": {
                    "agreement_pct": 80.0,
                    "overall_confidence": "medium",
                    "conflicts": [],
                    "suggested_accents": [],
                    "verified_per_elevation": [],
                },
                "walls": [{"width_ft": 30, "height_ft": 9}],
                "openings": [],
            }
        }
        r = admin_session.post(f"{API}/measure/map", json=payload, timeout=20)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "lines" in data
        assert "measurements" in data
        # The recheck field should have made the round trip cleanly
        assert "_ai_profile_recheck" in data["measurements"]
        assert data["measurements"]["_ai_profile_recheck"]["agreement_pct"] == 80.0
        # And lines should still be produced as usual
        assert isinstance(data["lines"], list)

    def test_map_without_recheck_field_still_works(self, admin_session):
        """Sanity check: same payload minus _ai_profile_recheck — same shape."""
        payload = {
            "measurements": {
                "walls": [{"width_ft": 30, "height_ft": 9}],
                "openings": [],
            }
        }
        r = admin_session.post(f"{API}/measure/map", json=payload, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "lines" in data
        assert isinstance(data["lines"], list)
