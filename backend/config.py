"""Centralised env-driven configuration. Import these constants anywhere."""
import os
import uuid
from pathlib import Path

ROOT_DIR = Path(__file__).parent

JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-" + uuid.uuid4().hex)
JWT_ALG = "HS256"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@wolfandson.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin123!")
ADMIN_COMPANY = os.environ.get("ADMIN_COMPANY", "Howard's Estimating Tool")

SUPPLIER_NAME = os.environ.get("SUPPLIER_NAME", "Alside Supply")
SUPPLIER_TAGLINE = os.environ.get(
    "SUPPLIER_TAGLINE",
    "Howard Hunt · Territory Sales Manager · (724) 640-4333",
)
SUPPLIER_ADMIN_TOKEN = os.environ.get("SUPPLIER_ADMIN_TOKEN", "")

SIGNUP_CODE = os.environ.get("SIGNUP_CODE", "")
if not SIGNUP_CODE:
    # Stable fallback derived from JWT_SECRET so the code survives restarts when not pinned.
    SIGNUP_CODE = "ALSIDE-" + uuid.uuid5(uuid.NAMESPACE_DNS, JWT_SECRET).hex[:6].upper()

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")

CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")

UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
