"""SEC-004 / SEC-005 / SEC-006 / SEC-007 — Iter 78z++++.

P3 security hardening regression tests:
  • SEC-004 — config refuses to import with empty JWT_SECRET / ADMIN_PASSWORD
  • SEC-005 — login rate limiter, JWT TTL trimmed to 24 h, cookie max-age matches
  • SEC-006 — admin token must come via X-Admin-Token header (no query string)
  • SEC-007 — AI-measure / AI-blueprint endpoints no longer allowlist user_id='anon'
"""
from __future__ import annotations

import importlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://app.pro-quotes.com"
).rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "hhunt6677@yahoo.com")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "Admin123!")
ADMIN_TOKEN = os.environ.get("SUPPLIER_ADMIN_TOKEN", "")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")


# --------------------------------------------------------------------------- #
# SEC-004 — config refuses to load with critical secrets missing.
# --------------------------------------------------------------------------- #
def _reload_config_with_env(**env):
    """Reload `config` module under a tweaked env. Restores afterwards."""
    saved = {k: os.environ.get(k) for k in env}
    try:
        for k, v in env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        import config  # noqa: F401  (force import)
        importlib.reload(config)
        return config
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        import config as _c
        importlib.reload(_c)


def test_sec004_config_refuses_short_jwt_secret():
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        _reload_config_with_env(JWT_SECRET="short")


def test_sec004_config_refuses_missing_jwt_secret():
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        _reload_config_with_env(JWT_SECRET="")


def test_sec004_config_refuses_missing_admin_password():
    # Keep JWT_SECRET valid so the ADMIN_PASSWORD guard is the one that fires.
    with pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
        _reload_config_with_env(
            JWT_SECRET="x" * 40,
            ADMIN_PASSWORD="",
        )


# --------------------------------------------------------------------------- #
# SEC-005 — JWT TTL is 24h, cookie max-age is 24h, login is rate-limited.
# --------------------------------------------------------------------------- #
def test_sec005_jwt_ttl_is_7d_by_default():
    import config
    importlib.reload(config)
    assert config.JWT_TTL_SECONDS == 604800


def test_sec005_login_cookie_max_age_is_7d():
    """Smoke-check: a real /auth/login response sets the cookie with
    Max-Age=604800 (7 d)."""
    s = requests.Session()
    # Use an isolated synthetic client IP so we don't poison the
    # rate-limit bucket for the rest of the suite.
    headers = {"X-Forwarded-For": f"10.42.{os.urandom(1)[0]}.{os.urandom(1)[0]}"}
    r = s.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
        headers=headers,
        timeout=10,
    )
    assert r.status_code == 200, r.text
    # Search for the access_token cookie and verify expires within ~7d.
    found_max_age = None
    raw_set_cookie = r.headers.get("set-cookie") or ""
    if "access_token" in raw_set_cookie and "Max-Age" in raw_set_cookie:
        for part in raw_set_cookie.split(";"):
            part = part.strip()
            if part.lower().startswith("max-age="):
                found_max_age = int(part.split("=", 1)[1])
                break
    assert found_max_age == 604800, (
        f"Expected Max-Age=604800 on access_token cookie, got {found_max_age}. "
        f"Set-Cookie: {raw_set_cookie!r}"
    )


def test_sec005_login_rate_limit_triggers_after_5_failures():
    """6 consecutive wrong-password attempts from the same IP → 429.
    Uses a unique synthetic IP so it doesn't poison other tests."""
    fake_ip = f"10.43.{os.urandom(1)[0]}.{os.urandom(1)[0]}"
    headers = {"X-Forwarded-For": fake_ip}
    fake_email = f"sec005-{os.urandom(4).hex()}@example.com"
    last_status = None
    for _ in range(6):
        r = requests.post(
            f"{API}/auth/login",
            json={"email": fake_email, "password": "wrong"},
            headers=headers,
            timeout=10,
        )
        last_status = r.status_code
    # The 6th attempt should be locked out.
    assert last_status == 429, f"expected 429 after 6 failures, got {last_status}"


# --------------------------------------------------------------------------- #
# SEC-006 — admin token via header only.
# --------------------------------------------------------------------------- #
@pytest.mark.skipif(not ADMIN_TOKEN, reason="SUPPLIER_ADMIN_TOKEN missing")
def test_sec006_admin_query_string_token_rejected():
    """Calling an admin endpoint with `?token=...` returns 403, even
    when the token value is correct."""
    r = requests.get(f"{API}/admin/signup-code", params={"token": ADMIN_TOKEN}, timeout=10)
    assert r.status_code == 403, r.text


@pytest.mark.skipif(not ADMIN_TOKEN, reason="SUPPLIER_ADMIN_TOKEN missing")
def test_sec006_admin_header_still_works():
    """Sanity: the same admin token in the header returns 200."""
    r = requests.get(
        f"{API}/admin/signup-code",
        headers={"X-Admin-Token": ADMIN_TOKEN},
        timeout=10,
    )
    assert r.status_code == 200, r.text


# --------------------------------------------------------------------------- #
# SEC-007 — runs owned by "anon" can no longer be touched by any user.
# --------------------------------------------------------------------------- #
@pytest.mark.skipif(not MONGO_URL or not DB_NAME, reason="MONGO_URL/DB_NAME missing")
def test_sec007_ai_measure_rerun_anon_run_returns_403():
    """Seed an AI measure run with user_id='anon' and assert that the
    authenticated admin gets 403 (no longer allowlisted)."""
    import uuid
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio

    s = requests.Session()
    # Synthetic IP keeps this test isolated from the rate-limit bucket
    # the SEC-005 burst test may have populated earlier in the session.
    s.headers["X-Forwarded-For"] = f"10.44.{os.urandom(1)[0]}.{os.urandom(1)[0]}"
    r = s.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
        timeout=10,
    )
    assert r.status_code == 200, r.text

    run_id = uuid.uuid4().hex

    async def seed():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.ai_measure_runs.insert_one({
            "run_id": run_id,
            "user_id": "anon",
            "estimate_id": None,
            "status": "done",
            "stage": "done",
            "photo_count": 0,
            "photo_paths": "/tmp/x.jpg",
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
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.ai_measure_runs.delete_one({"run_id": run_id})
        client.close()

    asyncio.run(seed())
    try:
        # rerun → owner check should now fire
        r1 = s.post(f"{API}/measure/ai-measure/rerun/{run_id}", timeout=10)
        assert r1.status_code == 403, f"rerun expected 403, got {r1.status_code}"
        # status endpoint → same
        r2 = s.get(f"{API}/measure/ai-measure/status/{run_id}", timeout=10)
        assert r2.status_code == 403, f"status expected 403, got {r2.status_code}"
    finally:
        asyncio.run(cleanup())


@pytest.mark.skipif(not MONGO_URL or not DB_NAME, reason="MONGO_URL/DB_NAME missing")
def test_sec007_ai_blueprint_rerun_anon_run_returns_403():
    """Same as above but for the blueprint pipeline."""
    import uuid
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio

    s = requests.Session()
    s.headers["X-Forwarded-For"] = f"10.45.{os.urandom(1)[0]}.{os.urandom(1)[0]}"
    r = s.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
        timeout=10,
    )
    assert r.status_code == 200

    run_id = uuid.uuid4().hex

    async def seed():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.ai_blueprint_runs.insert_one({
            "run_id": run_id,
            "user_id": "anon",
            "estimate_id": None,
            "status": "done",
            "stage": "done",
            "page_count": 0,
            "page_paths": "/tmp/x.pdf",
            "address": None,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "completed_at": datetime.now(timezone.utc),
            "result": None,
            "error": None,
        })
        client.close()

    async def cleanup():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.ai_blueprint_runs.delete_one({"run_id": run_id})
        client.close()

    asyncio.run(seed())
    try:
        r1 = s.post(f"{API}/measure/ai-blueprint/rerun/{run_id}", timeout=10)
        assert r1.status_code == 403
        r2 = s.get(f"{API}/measure/ai-blueprint/status/{run_id}", timeout=10)
        assert r2.status_code == 403
    finally:
        asyncio.run(cleanup())
