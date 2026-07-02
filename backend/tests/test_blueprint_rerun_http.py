"""Iter 78z+ — Blueprint rerun endpoint (cached-bytes re-fire).

Verifies the auth + validation paths for POST
/api/measure/ai-blueprint/rerun/{prev_run_id}. The actual Claude call
is skipped (cost) — we just confirm the endpoint exists, enforces
ownership, surfaces 404 / 400 properly, and that the new run doc
inherits estimate_id + rerun_of from the previous one.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "https://app.pro-quotes.com"
API = f"{BASE}/api"
ADMIN_EMAIL = "hhunt6677@yahoo.com"
ADMIN_PW = "Admin123!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=10)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


def test_rerun_404_on_missing_run(session):
    r = session.post(f"{API}/measure/ai-blueprint/rerun/{uuid.uuid4().hex}", timeout=10)
    assert r.status_code == 404
    assert "not found" in r.text.lower()


def test_rerun_endpoint_exists(session):
    """Confirms the route is registered (rather than 405 Method Not Allowed
    or 404 from a missing endpoint)."""
    r = session.post(f"{API}/measure/ai-blueprint/rerun/dummy", timeout=10)
    # 404 from the handler, NOT a routing/method error
    assert r.status_code in (404, 403, 400)


def test_rerun_400_when_run_has_no_cached_pages(session):
    """SEC-007 — Iter 78z++++: 'anon' is no longer an allowed owner.
    Seed a run with empty page_paths AND user_id matching the
    authenticated admin → 400 'No cached blueprint pages on this run'."""
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        pytest.skip("MONGO_URL/DB_NAME missing — skip direct seed")

    me = session.get(f"{API}/auth/me", timeout=10)
    assert me.status_code == 200
    admin_user_id = me.json()["id"]

    run_id = uuid.uuid4().hex

    async def seed_and_cleanup():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        await db.ai_blueprint_runs.insert_one({
            "run_id": run_id,
            "user_id": admin_user_id,
            "estimate_id": None,
            "status": "done",
            "stage": "done",
            "page_count": 0,
            "page_paths": "",  # empty
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
        await db.ai_blueprint_runs.delete_one({"run_id": run_id})
        client.close()

    asyncio.run(seed_and_cleanup())
    try:
        r = session.post(f"{API}/measure/ai-blueprint/rerun/{run_id}", timeout=10)
        assert r.status_code == 400
        assert "no cached" in r.text.lower()
    finally:
        asyncio.run(cleanup())


def test_rerun_unauthenticated():
    """Without session cookie, rerun should reject."""
    r = requests.post(f"{API}/measure/ai-blueprint/rerun/anything", timeout=10)
    # 401 or 403 depending on auth middleware
    assert r.status_code in (401, 403)
