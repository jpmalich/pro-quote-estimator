"""Registration / login / logout / me."""
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from config import SIGNUP_CODE, SUPPLIER_NAME
from db import db
from deps import (
    create_access_token,
    get_current_user,
    hash_password,
    set_auth_cookie,
    verify_password,
)
from models import LoginIn, RegisterIn
from services import create_company

router = APIRouter()

# SEC-005 — Iter 78z++++: Lightweight in-memory rate limiter on the
# login endpoint to slow brute-force attempts. Tracks failed attempts
# per client IP in a 15-minute sliding window. Successful logins clear
# the bucket so a legitimate user is never locked out by an earlier
# typo. Single-process: works for our supervisor-managed FastAPI
# (one worker). If we scale out we should move to Redis.
_LOGIN_WINDOW_SECONDS = 15 * 60  # 15 min
_LOGIN_MAX_FAILS = 5
_login_failures: dict[str, list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_login_rate_limit(ip: str):
    now = time.monotonic()
    bucket = _login_failures[ip]
    cutoff = now - _LOGIN_WINDOW_SECONDS
    fresh = [t for t in bucket if t >= cutoff]
    _login_failures[ip] = fresh
    if len(fresh) >= _LOGIN_MAX_FAILS:
        retry_in = int(_LOGIN_WINDOW_SECONDS - (now - fresh[0]))
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed login attempts. Try again in {max(retry_in, 1)}s.",
        )


def _record_login_failure(ip: str):
    _login_failures[ip].append(time.monotonic())


def _clear_login_failures(ip: str):
    _login_failures.pop(ip, None)


@router.post("/auth/register")
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")

    user_id = str(uuid.uuid4())

    # Determine company assignment
    company_id: Optional[str] = None
    role = "user"
    if body.invite_code:
        code = body.invite_code.strip().upper()
        company = await db.companies.find_one({"invite_code": code}, {"_id": 0})
        if not company:
            raise HTTPException(status_code=400, detail="Invalid invite code")
        company_id = company["id"]
        role = "member"
    else:
        # Creating a new company requires the supplier signup code
        provided = (body.signup_code or "").strip().upper()
        if not SIGNUP_CODE or provided != SIGNUP_CODE.upper():
            raise HTTPException(
                status_code=403,
                detail=f"Signup is invite-only. Contact {SUPPLIER_NAME} for an access code.",
            )
        cname = (body.company_name or f"{(body.name or email.split('@')[0])}'s Company").strip()
        company = await create_company(cname, user_id)
        company_id = company["id"]
        role = "owner"

    user_doc = {
        "id": user_id,
        "email": email,
        "name": body.name or email.split("@")[0],
        "password_hash": hash_password(body.password),
        "role": role,
        "company_id": company_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_id, email)
    set_auth_cookie(response, token)
    return {"id": user_id, "email": email, "name": user_doc["name"], "role": role, "company_id": company_id}


@router.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    ip = _client_ip(request)
    _check_login_rate_limit(ip)
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        _record_login_failure(ip)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    _clear_login_failures(ip)
    token = create_access_token(user["id"], email)
    set_auth_cookie(response, token)
    return {
        "id": user["id"], "email": user["email"], "name": user.get("name"),
        "role": user.get("role", "user"), "company_id": user.get("company_id"),
    }


@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/", samesite="none", secure=True)
    return {"ok": True}


@router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user
