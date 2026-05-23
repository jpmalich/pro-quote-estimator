from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import csv
import uuid
import secrets
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from catalog_seed import TIER_NAMES, DEFAULT_TIER_NAME, build_tier_sections

# ---------------------------------------------------------------------------
# Config & DB
# ---------------------------------------------------------------------------
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-" + uuid.uuid4().hex)
JWT_ALG = "HS256"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@wolfandson.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Admin123!")
ADMIN_COMPANY = os.environ.get("ADMIN_COMPANY", "Wolf and Son Renovations LLC")
SUPPLIER_NAME = os.environ.get("SUPPLIER_NAME", "Alside Supply")
SUPPLIER_TAGLINE = os.environ.get("SUPPLIER_TAGLINE", "Howard Hunt · Territory Sales Manager · (724) 640-4333")
SUPPLIER_ADMIN_TOKEN = os.environ.get("SUPPLIER_ADMIN_TOKEN", "")
SIGNUP_CODE = os.environ.get("SIGNUP_CODE", "")
if not SIGNUP_CODE:
    # Generate a stable signup code from JWT_SECRET so it survives restarts when not pinned
    SIGNUP_CODE = "ALSIDE-" + uuid.uuid5(uuid.NAMESPACE_DNS, JWT_SECRET).hex[:6].upper()
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
        "sub": user_id, "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token", value=token, httponly=True,
        secure=True, samesite="none", max_age=604800, path="/",
    )


def make_invite_code() -> str:
    # Short, human-friendly: 8 uppercase alphanumeric chars
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


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None
    company_name: Optional[str] = None
    invite_code: Optional[str] = None
    signup_code: Optional[str] = None  # required to create a new company


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


class CatalogOverridesIn(BaseModel):
    overrides: dict  # { "<section>::<name>": {"lab"?: float} }


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
    pricing_mode: str = "margin"  # "margin" => sell = base / (1 - pct/100); "markup" => sell = base * (1 + pct/100)
    lines: List[EstimateLine] = []
    misc_labor: List[MiscLine] = []
    misc_material: List[MiscLine] = []
    photos: List[str] = []
    status_label: str = "draft"


class EmailQuoteIn(BaseModel):
    recipient_email: EmailStr
    subject: Optional[str] = None
    message: Optional[str] = None
    html_quote: str


# ---------------------------------------------------------------------------
# Public Branding (no auth) + Supplier Admin
# ---------------------------------------------------------------------------
async def _get_branding() -> dict:
    doc = await db.settings.find_one({"id": "branding"}, {"_id": 0})
    if not doc:
        doc = {
            "id": "branding",
            "supplier_name": SUPPLIER_NAME,
            "supplier_tagline": SUPPLIER_TAGLINE,
            "supplier_logo_url": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.settings.insert_one(doc)
        doc.pop("_id", None)
    return doc


@api_router.get("/branding")
async def get_branding():
    b = await _get_branding()
    return {
        "supplier_name": b.get("supplier_name") or SUPPLIER_NAME,
        "supplier_tagline": b.get("supplier_tagline") or SUPPLIER_TAGLINE,
        "supplier_logo_url": b.get("supplier_logo_url"),
    }


def _check_admin_token(request: Request):
    token = request.headers.get("X-Admin-Token") or request.query_params.get("token")
    if not SUPPLIER_ADMIN_TOKEN or token != SUPPLIER_ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Forbidden")


class BrandingUpdate(BaseModel):
    supplier_name: Optional[str] = None
    supplier_tagline: Optional[str] = None
    supplier_logo_url: Optional[str] = None


@api_router.put("/admin/branding")
async def admin_update_branding(body: BrandingUpdate, request: Request):
    _check_admin_token(request)
    updates = {}
    if body.supplier_name is not None and body.supplier_name.strip():
        updates["supplier_name"] = body.supplier_name.strip()
    if body.supplier_tagline is not None:
        updates["supplier_tagline"] = body.supplier_tagline.strip()
    if body.supplier_logo_url is not None:
        updates["supplier_logo_url"] = body.supplier_logo_url or None
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.settings.update_one({"id": "branding"}, {"$set": updates}, upsert=True)
    return await _get_branding()


@api_router.post("/admin/upload-logo")
async def admin_upload_logo(request: Request, file: UploadFile = File(...)):
    _check_admin_token(request)
    ext = (file.filename or "").split(".")[-1].lower() or "png"
    if ext not in {"jpg", "jpeg", "png", "webp", "svg"}:
        ext = "png"
    name = f"supplier-logo-{uuid.uuid4().hex[:8]}.{ext}"
    dest = UPLOAD_DIR / name
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Logo too large (>5MB)")
    with open(dest, "wb") as f:
        f.write(content)
    url = f"/api/uploads/{name}"
    await db.settings.update_one(
        {"id": "branding"}, {"$set": {"supplier_logo_url": url, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"url": url}


@api_router.get("/admin/signup-code")
async def admin_get_signup_code(request: Request):
    _check_admin_token(request)
    return {"signup_code": SIGNUP_CODE}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
async def _ensure_tiers_seeded():
    """Seed the 4 standard price tiers if they don't exist yet."""
    existing = {t["name"] async for t in db.price_tiers.find({}, {"name": 1})}
    for name in TIER_NAMES:
        if name not in existing:
            await db.price_tiers.insert_one({
                "id": str(uuid.uuid4()),
                "name": name,
                "sections": build_tier_sections(name),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            logger.info("Seeded price tier %s", name)


async def _get_default_tier_id() -> str:
    t = await db.price_tiers.find_one({"name": DEFAULT_TIER_NAME}, {"id": 1})
    return t["id"] if t else None


async def _create_company(name: str, owner_user_id: str) -> dict:
    tier_id = await _get_default_tier_id()
    company = {
        "id": str(uuid.uuid4()),
        "name": name,
        "owner_user_id": owner_user_id,
        "invite_code": make_invite_code(),
        "logo_url": None,
        "quote_footer_enabled": True,
        "price_tier_id": tier_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.companies.insert_one(company)
    # Per-company catalog stores only labor overrides; material is locked to the
    # assigned price tier (managed by the supplier in /branding-admin).
    await db.catalogs.insert_one({
        "company_id": company["id"],
        "overrides": {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return company


@api_router.post("/auth/register")
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
        company = await _create_company(cname, user_id)
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


@api_router.post("/auth/login")
async def login(body: LoginIn, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], email)
    set_auth_cookie(response, token)
    return {
        "id": user["id"], "email": user["email"], "name": user.get("name"),
        "role": user.get("role", "user"), "company_id": user.get("company_id"),
    }


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/", samesite="none", secure=True)
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------------------------------------------------------------------------
# Company
# ---------------------------------------------------------------------------
class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None  # set "" or None to clear
    quote_footer_enabled: Optional[bool] = None


@api_router.get("/company")
async def get_company(user: dict = Depends(get_current_user)):
    company = await get_company_for(user)
    return company


@api_router.put("/company")
async def update_company(body: CompanyUpdate, user: dict = Depends(get_current_user)):
    company = await get_company_for(user)
    updates = {}
    if body.name is not None and body.name.strip():
        updates["name"] = body.name.strip()
    if body.logo_url is not None:
        # Empty string clears the logo
        updates["logo_url"] = body.logo_url or None
    if body.quote_footer_enabled is not None:
        updates["quote_footer_enabled"] = bool(body.quote_footer_enabled)
    if updates:
        await db.companies.update_one({"id": company["id"]}, {"$set": updates})
    return await db.companies.find_one({"id": company["id"]}, {"_id": 0})


# ---------------------------------------------------------------------------
# Catalog (per company): material from assigned tier + per-company overrides
# ---------------------------------------------------------------------------
def _key(section: str, name: str) -> str:
    return f"{section}::{name}"


async def _resolve_catalog_for_company(company: dict) -> dict:
    """Merge the company's assigned tier (material baseline) with their per-company
    overrides (custom mat / lab). Returns shape: {sections, tier_id, tier_name, locked_material}."""
    tier_id = company.get("price_tier_id")
    tier = await db.price_tiers.find_one({"id": tier_id}, {"_id": 0}) if tier_id else None
    if not tier:
        # Fallback: seed default if missing
        await _ensure_tiers_seeded()
        tier = await db.price_tiers.find_one({"name": DEFAULT_TIER_NAME}, {"_id": 0})

    cat = await db.catalogs.find_one({"company_id": company["id"]}, {"_id": 0})
    overrides = (cat or {}).get("overrides", {})

    sections = []
    for s in tier["sections"]:
        items_out = []
        for it in s["items"]:
            k = _key(s["title"], it["name"])
            ov = overrides.get(k, {})
            items_out.append({
                "name": it["name"], "unit": it["unit"],
                "mat": float(ov["mat"]) if "mat" in ov else float(it["mat"]),
                "lab": float(ov["lab"]) if "lab" in ov else float(it["lab"]),
                "tier_mat": float(it["mat"]),      # so UI can show "Tier default: $X"
                "tier_lab": float(it["lab"]),
                "mat_overridden": "mat" in ov,
                "lab_overridden": "lab" in ov,
            })
        sections.append({"title": s["title"], "ascend": s.get("ascend", False), "items": items_out})
    return {
        "sections": sections,
        "tier_id": tier["id"],
        "tier_name": tier["name"],
    }


@api_router.get("/catalog")
async def get_catalog(user: dict = Depends(get_current_user)):
    company = await get_company_for(user)
    return await _resolve_catalog_for_company(company)


@api_router.put("/catalog")
async def update_catalog_overrides(body: CatalogOverridesIn, user: dict = Depends(get_current_user)):
    """Save the contractor's per-line labor overrides. Material is supplier-controlled
    (set per-tier) and is intentionally stripped here — contractors cannot override material."""
    clean = {}
    for k, v in (body.overrides or {}).items():
        if not isinstance(v, dict):
            continue
        keep = {}
        # Material is locked to the assigned tier; ignore any client-side `mat` payload
        if "lab" in v and v["lab"] is not None:
            keep["lab"] = float(v["lab"])
        if keep:
            clean[k] = keep
    await db.catalogs.update_one(
        {"company_id": user["company_id"]},
        {"$set": {"overrides": clean, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    company = await get_company_for(user)
    return await _resolve_catalog_for_company(company)


@api_router.post("/catalog/reset")
async def reset_catalog(user: dict = Depends(get_current_user)):
    """Clear all per-company overrides (back to assigned tier defaults)."""
    await db.catalogs.update_one(
        {"company_id": user["company_id"]},
        {"$set": {"overrides": {}, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    company = await get_company_for(user)
    return await _resolve_catalog_for_company(company)


# ---------------------------------------------------------------------------
# Admin: Price Tier management (supplier-only via token)
# ---------------------------------------------------------------------------
@api_router.get("/admin/tiers")
async def admin_list_tiers(request: Request):
    _check_admin_token(request)
    await _ensure_tiers_seeded()
    cursor = db.price_tiers.find({}, {"_id": 0}).sort("name", 1)
    return await cursor.to_list(50)


@api_router.get("/admin/tiers/{tier_id}")
async def admin_get_tier(tier_id: str, request: Request):
    _check_admin_token(request)
    t = await db.price_tiers.find_one({"id": tier_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    return t


class TierUpdate(BaseModel):
    name: Optional[str] = None
    sections: Optional[List[CatalogSection]] = None


@api_router.put("/admin/tiers/{tier_id}")
async def admin_update_tier(tier_id: str, body: TierUpdate, request: Request):
    _check_admin_token(request)
    updates = {}
    if body.name:
        updates["name"] = body.name.strip()
    if body.sections is not None:
        updates["sections"] = [s.model_dump() for s in body.sections]
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        res = await db.price_tiers.update_one({"id": tier_id}, {"$set": updates})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
    return await db.price_tiers.find_one({"id": tier_id}, {"_id": 0})


@api_router.get("/admin/companies")
async def admin_list_companies(request: Request):
    _check_admin_token(request)
    cursor = db.companies.find({}, {"_id": 0}).sort("created_at", -1)
    companies = await cursor.to_list(500)
    # Attach tier name + counts
    tiers = {t["id"]: t["name"] async for t in db.price_tiers.find({}, {"id": 1, "name": 1})}
    for c in companies:
        c["tier_name"] = tiers.get(c.get("price_tier_id"))
        c["estimate_count"] = await db.estimates.count_documents({"company_id": c["id"]})
    return companies


class CompanyTierAssign(BaseModel):
    price_tier_id: str


@api_router.put("/admin/companies/{company_id}/tier")
async def admin_assign_tier(company_id: str, body: CompanyTierAssign, request: Request):
    _check_admin_token(request)
    tier = await db.price_tiers.find_one({"id": body.price_tier_id}, {"_id": 0})
    if not tier:
        raise HTTPException(status_code=400, detail="Tier not found")
    res = await db.companies.update_one(
        {"id": company_id}, {"$set": {"price_tier_id": body.price_tier_id}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Company not found")
    return await db.companies.find_one({"id": company_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# Estimates (scoped to company)
# ---------------------------------------------------------------------------
@api_router.get("/estimates")
async def list_estimates(user: dict = Depends(get_current_user)):
    cursor = db.estimates.find({"company_id": user["company_id"]}, {"_id": 0}).sort("updated_at", -1)
    return await cursor.to_list(500)


@api_router.post("/estimates")
async def create_estimate(body: EstimateIn, user: dict = Depends(get_current_user)):
    est_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = body.model_dump()
    doc.update({
        "id": est_id,
        "company_id": user["company_id"],
        "created_by": user["id"],
        "created_by_name": user.get("name"),
        "created_at": now,
        "updated_at": now,
    })
    await db.estimates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/estimates/{est_id}")
async def get_estimate(est_id: str, user: dict = Depends(get_current_user)):
    doc = await db.estimates.find_one(
        {"id": est_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


@api_router.put("/estimates/{est_id}")
async def update_estimate(est_id: str, body: EstimateIn, user: dict = Depends(get_current_user)):
    update = body.model_dump()
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.estimates.update_one(
        {"id": est_id, "company_id": user["company_id"]}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.estimates.find_one({"id": est_id}, {"_id": 0})


@api_router.delete("/estimates/{est_id}")
async def delete_estimate(est_id: str, user: dict = Depends(get_current_user)):
    res = await db.estimates.delete_one({"id": est_id, "company_id": user["company_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# CSV Export (registered BEFORE /estimates/{est_id} so the literal path wins)
# ---------------------------------------------------------------------------
def _calc_totals(est: dict) -> dict:
    lines = est.get("lines", []) or []
    misc_labor = est.get("misc_labor", []) or []
    misc_material = est.get("misc_material", []) or []
    sub_mat = sum((ln.get("qty", 0) or 0) * (ln.get("mat", 0) or 0) for ln in lines) + sum((m.get("mat", 0) or 0) for m in misc_material)
    sub_lab = sum((ln.get("qty", 0) or 0) * (ln.get("lab", 0) or 0) for ln in lines) + sum((m.get("lab", 0) or 0) for m in misc_material) + sum((m.get("lab", 0) or 0) for m in misc_labor)
    wasted = sub_mat * (1 + (est.get("waste_pct", 0) or 0) / 100)
    tax = wasted * ((est.get("tax_rate", 0) or 0) / 100) if est.get("tax_enabled") else 0
    base = wasted + tax + sub_lab
    pct = (est.get("margin_pct", 0) or 0) / 100
    # Legacy estimates without pricing_mode were created under the old markup behavior.
    mode = est.get("pricing_mode") or "markup"
    if mode == "margin":
        # True margin: cap at 99% to avoid divide-by-zero / negative denominator.
        denom = 1 - min(pct, 0.99)
        sell = base / denom if denom > 0 else base
    else:
        sell = base * (1 + pct)
    profit = sell - base
    return {"sub_mat": sub_mat, "sub_lab": sub_lab, "wasted": wasted, "tax": tax, "base": base, "sell": sell, "profit": profit}


@api_router.get("/exports/estimates.csv")
async def export_estimates_csv(user: dict = Depends(get_current_user)):
    cursor = db.estimates.find({"company_id": user["company_id"]}, {"_id": 0}).sort("updated_at", -1)
    estimates = await cursor.to_list(2000)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Estimate #", "Customer", "Address", "Date", "Estimator",
        "Material", "Labor", "Tax", "Base", "Pricing Mode", "Margin/Markup %", "Sell Price", "Profit",
        "Created By", "Updated At",
    ])
    for e in estimates:
        t = _calc_totals(e)
        writer.writerow([
            e.get("estimate_number", ""), e.get("customer_name", ""),
            e.get("address", ""), e.get("estimate_date", ""), e.get("estimator", ""),
            f"{t['sub_mat']:.2f}", f"{t['sub_lab']:.2f}", f"{t['tax']:.2f}",
            f"{t['base']:.2f}", e.get("pricing_mode") or "markup", e.get("margin_pct", 0),
            f"{t['sell']:.2f}", f"{t['profit']:.2f}",
            e.get("created_by_name", ""), e.get("updated_at", ""),
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="estimates.csv"'},
    )


@api_router.get("/exports/estimates/{est_id}.csv")
async def export_estimate_csv(est_id: str, user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one({"id": est_id, "company_id": user["company_id"]}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Not found")
    t = _calc_totals(est)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Field", "Value"])
    for k, v in [
        ("Estimate #", est.get("estimate_number", "")),
        ("Customer", est.get("customer_name", "")),
        ("Address", est.get("address", "")),
        ("Date", est.get("estimate_date", "")),
        ("Estimator", est.get("estimator", "")),
        ("Notes", (est.get("notes", "") or "").replace("\n", " ")),
        ("Waste %", est.get("waste_pct", 0)),
        ("Tax Enabled", est.get("tax_enabled", True)),
        ("Tax Rate %", est.get("tax_rate", 0)),
        ("Pricing Mode", est.get("pricing_mode") or "markup"),
        ("Margin/Markup %", est.get("margin_pct", 0)),
    ]:
        writer.writerow([k, v])
    writer.writerow([])
    writer.writerow(["Section", "Item", "Unit", "Qty", "Material $", "Labor $", "Line Total"])
    for ln in est.get("lines", []) or []:
        if (ln.get("qty", 0) or 0) > 0:
            qty = ln["qty"] or 0
            line_total = qty * ((ln.get("mat", 0) or 0) + (ln.get("lab", 0) or 0))
            writer.writerow([ln["section"], ln["name"], ln["unit"], qty, ln.get("mat", 0), ln.get("lab", 0), f"{line_total:.2f}"])
    for m in est.get("misc_labor", []) or []:
        writer.writerow(["Misc. Labor Only", m.get("desc", ""), "—", 1, 0, m.get("lab", 0), f"{(m.get('lab', 0) or 0):.2f}"])
    for m in est.get("misc_material", []) or []:
        writer.writerow(["Misc. Labor & Material", m.get("desc", ""), "—", 1, m.get("mat", 0), m.get("lab", 0), f"{((m.get('mat', 0) or 0) + (m.get('lab', 0) or 0)):.2f}"])
    writer.writerow([])
    writer.writerow(["Summary", ""])
    writer.writerow(["Material Subtotal", f"{t['sub_mat']:.2f}"])
    writer.writerow(["After Waste", f"{t['wasted']:.2f}"])
    writer.writerow(["Tax", f"{t['tax']:.2f}"])
    writer.writerow(["Labor Subtotal", f"{t['sub_lab']:.2f}"])
    writer.writerow(["Base Cost", f"{t['base']:.2f}"])
    writer.writerow(["Sell Price", f"{t['sell']:.2f}"])
    writer.writerow(["Profit", f"{t['profit']:.2f}"])
    buf.seek(0)
    fname = f"estimate_{(est.get('estimate_number') or est['id']).replace(' ', '_')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ---------------------------------------------------------------------------
# Uploads
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
    target = UPLOAD_DIR / name
    if not target.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(target))


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------
@api_router.post("/estimates/{est_id}/email")
async def email_quote(est_id: str, body: EmailQuoteIn, user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one(
        {"id": est_id, "company_id": user["company_id"]}, {"_id": 0}
    )
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
# Startup: indexes + admin seed + migration
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def on_start():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.estimates.create_index("id", unique=True)
    await db.estimates.create_index("company_id")
    await db.catalogs.create_index("company_id", unique=True)
    await db.companies.create_index("id", unique=True)
    await db.companies.create_index("invite_code", unique=True)
    await db.price_tiers.create_index("id", unique=True)
    await db.price_tiers.create_index("name", unique=True)

    # Seed the 4 price tiers
    await _ensure_tiers_seeded()

    # Migrate old catalog docs that still have `sections` -> convert to empty overrides
    # (material now comes from tier; we keep their labor if it differed by storing as override).
    legacy_cats = db.catalogs.find({"sections": {"$exists": True}})
    async for legacy in legacy_cats:
        await db.catalogs.update_one(
            {"_id": legacy["_id"]},
            {"$unset": {"sections": ""}, "$set": {"overrides": legacy.get("overrides", {})}},
        )

    # Migrate old global catalog (id="default") -> company-scoped if present
    legacy = await db.catalogs.find_one({"id": "default"})
    if legacy:
        await db.catalogs.delete_one({"id": "default"})

    # Seed admin user
    admin = await db.users.find_one({"email": ADMIN_EMAIL.lower()})
    admin_id = admin["id"] if admin else str(uuid.uuid4())

    # Ensure admin's company exists
    admin_company = None
    if admin:
        if admin.get("company_id"):
            admin_company = await db.companies.find_one({"id": admin["company_id"]})
    if not admin_company:
        admin_company = await _create_company(ADMIN_COMPANY, admin_id)

    if not admin:
        await db.users.insert_one({
            "id": admin_id,
            "email": ADMIN_EMAIL.lower(),
            "name": "Admin",
            "password_hash": hash_password(ADMIN_PASSWORD),
            "role": "owner",
            "company_id": admin_company["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Seeded admin user %s", ADMIN_EMAIL)
    else:
        updates = {}
        if not verify_password(ADMIN_PASSWORD, admin["password_hash"]):
            updates["password_hash"] = hash_password(ADMIN_PASSWORD)
        if not admin.get("company_id"):
            updates["company_id"] = admin_company["id"]
            updates["role"] = "owner"
        if updates:
            await db.users.update_one({"email": ADMIN_EMAIL.lower()}, {"$set": updates})

    # Migrate any orphan estimates without company_id -> admin's company
    await db.estimates.update_many(
        {"company_id": {"$exists": False}},
        {"$set": {"company_id": admin_company["id"]}},
    )

    # Backfill quote_footer_enabled on legacy companies so GET /api/company is uniform
    await db.companies.update_many(
        {"quote_footer_enabled": {"$exists": False}},
        {"$set": {"quote_footer_enabled": True}},
    )

    # Backfill price_tier_id on legacy companies (assign cheapest default)
    default_tier_id = await _get_default_tier_id()
    if default_tier_id:
        await db.companies.update_many(
            {"price_tier_id": {"$exists": False}},
            {"$set": {"price_tier_id": default_tier_id}},
        )

    # Backfill pricing_mode on legacy estimates to "markup" (preserves their existing
    # sell prices; new estimates default to "margin" via EstimateIn.pricing_mode).
    await db.estimates.update_many(
        {"pricing_mode": {"$exists": False}},
        {"$set": {"pricing_mode": "markup"}},
    )

    if not SUPPLIER_ADMIN_TOKEN:
        logger.warning(
            "SUPPLIER_ADMIN_TOKEN is not set — /api/admin/* endpoints will reject all requests. "
            "Set it in backend/.env to enable the /branding-admin page."
        )


@app.on_event("shutdown")
async def shutdown():
    client.close()
