from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, status
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from catalog_seed import DEFAULT_SECTIONS

# ---------------------------------------------------------------------------
# Config & DB
# ---------------------------------------------------------------------------
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-prod-" + uuid.uuid4().hex)
JWT_ALG = "HS256"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@wolfandson.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin123!")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")

UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Vinyl Siding Estimator API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("estimator")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
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
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token", value=token, httponly=True,
        secure=True, samesite="none", max_age=604800, path="/",
    )


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


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class CatalogItem(BaseModel):
    name: str
    unit: str
    mat: float
    lab: float


class CatalogSection(BaseModel):
    title: str
    ascend: bool = False
    items: List[CatalogItem]


class CatalogIn(BaseModel):
    sections: List[CatalogSection]


class EstimateLine(BaseModel):
    section: str
    name: str
    unit: str
    qty: float = 0
    mat: float = 0
    lab: float = 0


class MiscLine(BaseModel):
    desc: str = ""
    mat: float = 0
    lab: float = 0


class EstimateIn(BaseModel):
    customer_name: str = ""
    address: str = ""
    estimate_number: str = ""
    estimate_date: str = ""
    estimator: str = ""
    notes: str = ""
    waste_pct: float = 0
    tax_enabled: bool = True
    tax_rate: float = 7.0
    margin_pct: float = 30.0
    lines: List[EstimateLine] = []
    misc_labor: List[MiscLine] = []
    misc_material: List[MiscLine] = []
    photos: List[str] = []  # urls
    status_label: str = "draft"


class EmailQuoteIn(BaseModel):
    recipient_email: EmailStr
    subject: Optional[str] = None
    message: Optional[str] = None
    html_quote: str  # rendered HTML of quote


# ---------------------------------------------------------------------------
# Auth Endpoints
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "name": body.name or email.split("@")[0],
        "password_hash": hash_password(body.password),
        "role": "user",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_id, email)
    set_auth_cookie(response, token)
    return {"id": user_id, "email": email, "name": user_doc["name"], "role": "user"}


@api_router.post("/auth/login")
async def login(body: LoginIn, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], email)
    set_auth_cookie(response, token)
    return {"id": user["id"], "email": user["email"], "name": user.get("name"), "role": user.get("role", "user")}


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------------------------------------------------------------------------
# Catalog (global, one shared catalog per deployment)
# ---------------------------------------------------------------------------
CATALOG_ID = "default"


@api_router.get("/catalog")
async def get_catalog(user: dict = Depends(get_current_user)):
    cat = await db.catalogs.find_one({"id": CATALOG_ID}, {"_id": 0})
    if not cat:
        cat = {"id": CATALOG_ID, "sections": DEFAULT_SECTIONS,
               "updated_at": datetime.now(timezone.utc).isoformat()}
        await db.catalogs.insert_one(cat)
        cat.pop("_id", None)
    return cat


@api_router.put("/catalog")
async def update_catalog(body: CatalogIn, user: dict = Depends(get_current_user)):
    payload = {
        "id": CATALOG_ID,
        "sections": [s.model_dump() for s in body.sections],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.catalogs.update_one({"id": CATALOG_ID}, {"$set": payload}, upsert=True)
    return payload


@api_router.post("/catalog/reset")
async def reset_catalog(user: dict = Depends(get_current_user)):
    payload = {"id": CATALOG_ID, "sections": DEFAULT_SECTIONS,
               "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.catalogs.update_one({"id": CATALOG_ID}, {"$set": payload}, upsert=True)
    return payload


# ---------------------------------------------------------------------------
# Estimates
# ---------------------------------------------------------------------------
@api_router.get("/estimates")
async def list_estimates(user: dict = Depends(get_current_user)):
    cursor = db.estimates.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1)
    items = await cursor.to_list(500)
    return items


@api_router.post("/estimates")
async def create_estimate(body: EstimateIn, user: dict = Depends(get_current_user)):
    est_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = body.model_dump()
    doc.update({
        "id": est_id, "user_id": user["id"],
        "created_at": now, "updated_at": now,
    })
    await db.estimates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/estimates/{est_id}")
async def get_estimate(est_id: str, user: dict = Depends(get_current_user)):
    doc = await db.estimates.find_one({"id": est_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


@api_router.put("/estimates/{est_id}")
async def update_estimate(est_id: str, body: EstimateIn, user: dict = Depends(get_current_user)):
    update = body.model_dump()
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.estimates.update_one(
        {"id": est_id, "user_id": user["id"]}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    doc = await db.estimates.find_one({"id": est_id}, {"_id": 0})
    return doc


@api_router.delete("/estimates/{est_id}")
async def delete_estimate(est_id: str, user: dict = Depends(get_current_user)):
    res = await db.estimates.delete_one({"id": est_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Photo Upload
# ---------------------------------------------------------------------------
@api_router.post("/uploads")
async def upload_photo(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = (file.filename or "").split(".")[-1].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "webp", "heic"}:
        ext = "jpg"
    name = f"{uuid.uuid4().hex}.{ext}"
    dest = UPLOAD_DIR / name
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (>10MB)")
    with open(dest, "wb") as f:
        f.write(content)
    return {"url": f"/api/uploads/{name}", "name": name}


@api_router.get("/uploads/{name}")
async def serve_upload(name: str):
    from fastapi.responses import FileResponse
    target = UPLOAD_DIR / name
    if not target.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(target))


# ---------------------------------------------------------------------------
# Email Quote (Resend)
# ---------------------------------------------------------------------------
@api_router.post("/estimates/{est_id}/email")
async def email_quote(est_id: str, body: EmailQuoteIn, user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one({"id": est_id, "user_id": user["id"]}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    if not RESEND_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Email service not configured. Add RESEND_API_KEY to enable.",
        )
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        params = {
            "from": SENDER_EMAIL,
            "to": [body.recipient_email],
            "subject": body.subject or f"Your Estimate from {user.get('name', 'Wolf and Son Renovations')}",
            "html": body.html_quote,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        return {"status": "sent", "id": result.get("id")}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("email failed")
        raise HTTPException(status_code=500, detail=f"Email failed: {e}")


@api_router.get("/email/status")
async def email_status(user: dict = Depends(get_current_user)):
    return {"configured": bool(RESEND_API_KEY), "sender": SENDER_EMAIL if RESEND_API_KEY else None}


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"ok": True, "app": "Vinyl Siding Estimator"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Startup: indexes + seeds
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def on_start():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.estimates.create_index("id", unique=True)
    await db.estimates.create_index("user_id")
    await db.catalogs.create_index("id", unique=True)

    # Seed admin user
    admin = await db.users.find_one({"email": ADMIN_EMAIL.lower()})
    if not admin:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": ADMIN_EMAIL.lower(),
            "name": "Admin",
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded admin user %s", ADMIN_EMAIL)
    elif not verify_password(ADMIN_PASSWORD, admin["password_hash"]):
        await db.users.update_one(
            {"email": ADMIN_EMAIL.lower()},
            {"$set": {"password_hash": hash_password(ADMIN_PASSWORD)}},
        )

    # Seed catalog
    if not await db.catalogs.find_one({"id": CATALOG_ID}):
        await db.catalogs.insert_one({
            "id": CATALOG_ID,
            "sections": DEFAULT_SECTIONS,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded default catalog")


@app.on_event("shutdown")
async def shutdown():
    client.close()
