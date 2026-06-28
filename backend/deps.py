"""Security & dependency-injection helpers used across all routes."""
import secrets
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from fastapi import HTTPException, Request, Response

from config import JWT_SECRET, JWT_ALG, JWT_TTL_SECONDS, SUPPLIER_ADMIN_TOKEN
from db import db


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=JWT_TTL_SECONDS),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=JWT_TTL_SECONDS,
        path="/",
    )


def make_invite_code() -> str:
    # Short, human-friendly: 8 uppercase alphanumeric chars (excludes I, L, O, 0, 1).
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_company_for(user: dict) -> dict:
    if not user.get("company_id"):
        raise HTTPException(status_code=400, detail="User has no company")
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


def check_admin_token(request: Request):
    # SEC-006 — Iter 78z++++: header-only admin token check.
    # Tokens in query strings leak into browser history, web server
    # access logs, and referrer headers. The branding-admin frontend
    # now sends the token as `X-Admin-Token`.
    token = request.headers.get("X-Admin-Token")
    if not SUPPLIER_ADMIN_TOKEN or not token or token != SUPPLIER_ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Forbidden")
