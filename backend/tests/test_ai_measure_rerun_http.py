"""Iter 78z+ — AI Measure rerun endpoint.

Mirrors the blueprint rerun tests. Verifies the validation surface
(404 / 403 / 400 / 401) without paying for a real Claude call.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "https://app-converter-170.preview.emergentagent.com"
API = f"{BASE}/api"
ADMIN_EMAIL = "hhunt6677@yahoo.com"
ADMIN_PW = "Admin123!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=10)
    assert r.status_code == 200
    return s


def test_rerun_404_on_missing_run(session):
    r = session.post(f"{API}/measure/ai-measure/rerun/{uuid.uuid4().hex}", timeout=10)
    assert r.status_code == 404


def test_rerun_endpoint_exists(session):
    r = session.post(f"{API}/measure/ai-measure/rerun/dummy", timeout=10)
    assert r.status_code in (404, 403, 400)


def test_rerun_400_when_run_has_no_cached_photos(session):
    """SEC-007 — Iter 78z++++: 'anon' is no longer an allowed owner.
    Seed a run with empty photo_paths AND user_id matching the
    authenticated admin → 400."""
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL/DB_NAME missing")

    # Look up the admin user_id once so we own the seeded run.
    me = session.get(f"{API}/auth/me", timeout=10)
    assert me.status_code == 200
    admin_user_id = me.json()["id"]

    run_id = uuid.uuid4().hex

    async def seed():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.ai_measure_runs.insert_one({
            "run_id": run_id,
            "user_id": admin_user_id,
            "estimate_id": None,
            "status": "done",
            "stage": "done",
            "photo_count": 0,
            "photo_paths": "",
            "deep_dormer_scan": False,
            "kind": "siding",
            "address": None,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "completed_at": datetime.now(timezone.utc),
            "result": None,
            "error": None,
        })
        client.close()

    async def cleanup():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.ai_measure_runs.delete_one({"run_id": run_id})
        client.close()

    asyncio.run(seed())
    try:
        r = session.post(f"{API}/measure/ai-measure/rerun/{run_id}", timeout=10)
        assert r.status_code == 400
        assert "no cached" in r.text.lower()
    finally:
        asyncio.run(cleanup())


def test_rerun_unauthenticated():
    r = requests.post(f"{API}/measure/ai-measure/rerun/anything", timeout=10)
    assert r.status_code in (401, 403)
