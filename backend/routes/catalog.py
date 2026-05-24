"""Per-company catalog (tier-aware) + supplier-admin tier / company endpoints."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from catalog_seed import DEFAULT_TIER_NAME
from db import db
from deps import check_admin_token, get_company_for, get_current_user
from models import CatalogOverridesIn, CompanyTierAssign, TierUpdate
from services import ensure_tiers_seeded

router = APIRouter()


# ---------------------------------------------------------------------------
# Catalog (per company): material from assigned tier + per-company overrides
# ---------------------------------------------------------------------------
def _key(section: str, name: str) -> str:
    return f"{section}::{name}"


async def _resolve_catalog_for_company(company: dict) -> dict:
    """Merge the company's assigned tier (material baseline) with their per-company
    overrides (custom mat / lab). Returns shape: {sections, tier_id, tier_name}."""
    tier_id = company.get("price_tier_id")
    tier = await db.price_tiers.find_one({"id": tier_id}, {"_id": 0}) if tier_id else None
    if not tier:
        # Fallback: seed default if missing
        await ensure_tiers_seeded()
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
    return {"sections": sections, "tier_id": tier["id"], "tier_name": tier["name"]}


@router.get("/catalog")
async def get_catalog(user: dict = Depends(get_current_user)):
    company = await get_company_for(user)
    return await _resolve_catalog_for_company(company)


@router.put("/catalog")
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


@router.post("/catalog/reset")
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
@router.get("/admin/tiers")
async def admin_list_tiers(request: Request):
    check_admin_token(request)
    await ensure_tiers_seeded()
    cursor = db.price_tiers.find({}, {"_id": 0}).sort("name", 1)
    return await cursor.to_list(50)


@router.get("/admin/tiers/{tier_id}")
async def admin_get_tier(tier_id: str, request: Request):
    check_admin_token(request)
    t = await db.price_tiers.find_one({"id": tier_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    return t


@router.put("/admin/tiers/{tier_id}")
async def admin_update_tier(tier_id: str, body: TierUpdate, request: Request):
    check_admin_token(request)
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


@router.get("/admin/companies")
async def admin_list_companies(request: Request):
    check_admin_token(request)
    cursor = db.companies.find({}, {"_id": 0}).sort("created_at", -1)
    companies = await cursor.to_list(500)
    tiers = {t["id"]: t["name"] async for t in db.price_tiers.find({}, {"id": 1, "name": 1})}
    for c in companies:
        c["tier_name"] = tiers.get(c.get("price_tier_id"))
        c["estimate_count"] = await db.estimates.count_documents({"company_id": c["id"]})
    return companies


@router.put("/admin/companies/{company_id}/tier")
async def admin_assign_tier(company_id: str, body: CompanyTierAssign, request: Request):
    check_admin_token(request)
    tier = await db.price_tiers.find_one({"id": body.price_tier_id}, {"_id": 0})
    if not tier:
        raise HTTPException(status_code=400, detail="Tier not found")
    res = await db.companies.update_one(
        {"id": company_id}, {"$set": {"price_tier_id": body.price_tier_id}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Company not found")
    return await db.companies.find_one({"id": company_id}, {"_id": 0})


@router.delete("/admin/companies/{company_id}")
async def admin_delete_company(company_id: str, request: Request):
    """Cascade-delete a contractor company along with everything it owns:
    users, estimates, and the per-company catalog overrides doc."""
    check_admin_token(request)
    company = await db.companies.find_one({"id": company_id}, {"_id": 0, "id": 1, "name": 1})
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    estimates_deleted = (await db.estimates.delete_many({"company_id": company_id})).deleted_count
    users_deleted = (await db.users.delete_many({"company_id": company_id})).deleted_count
    await db.catalogs.delete_many({"company_id": company_id})
    await db.companies.delete_one({"id": company_id})
    return {
        "ok": True,
        "company_name": company["name"],
        "estimates_deleted": estimates_deleted,
        "users_deleted": users_deleted,
    }
