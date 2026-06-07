"""Mezzo (3000 Series) replacement-window catalog endpoint + admin matrix."""
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import mezzo_prices
from catalog_seed import DEFAULT_TIER_NAME
from db import db
from deps import check_admin_token, get_company_for, get_current_user
from mezzo_catalog import (
    MEZZO_ADDER_NAMES,
    MEZZO_BUCKETS,
    MEZZO_PRODUCT_TYPES,
    MEZZO_TIER_NAMES,
    catalog_for_tier_async,
)

router = APIRouter()


@router.get("/mezzo/catalog")
async def get_mezzo_catalog(user: dict = Depends(get_current_user)):
    """Return the Mezzo product-type matrix for the contractor's tier."""
    company = await get_company_for(user)
    tier_id = company.get("price_tier_id")
    tier_doc = await db.price_tiers.find_one({"id": tier_id}, {"_id": 0, "name": 1}) if tier_id else None
    tier_name = tier_doc["name"] if tier_doc else DEFAULT_TIER_NAME
    return await catalog_for_tier_async(tier_name, mezzo_prices)


# ─────────────────── Admin Mezzo Pricing Matrix ───────────────────

class MezzoPriceUpdate(BaseModel):
    tier: str
    product_type: str
    base_prices: Dict[str, float]
    adder_prices: Dict[str, Dict[str, float]]


@router.get("/admin/mezzo/prices")
async def admin_get_mezzo_prices(request: Request):
    """Return the full 4 tier × 4 product matrix plus metadata for the
    Pricing Admin UI. Shape:
        {
          tiers: ["whole-sale", "Contractor", "Builder-Dealer", "one-opp"],
          products: ["Mezzo Double Hung", ...],
          buckets: { "Mezzo Double Hung": [{label,min_ui,max_ui}, ...], ... },
          adders:  { "Mezzo Double Hung": ["Extruded Beige or Clay", ...], ... },
          data:    { "<tier>": { "<product>": {base_prices, adder_prices} } }
        }
    """
    check_admin_token(request)
    rows = await mezzo_prices.list_all_prices()
    by_key = {(r["tier"], r["product_type"]): r for r in rows}
    data: Dict[str, Dict[str, dict]] = {}
    for tier in MEZZO_TIER_NAMES:
        data[tier] = {}
        for pt in MEZZO_PRODUCT_TYPES.keys():
            doc = by_key.get((tier, pt))
            if doc:
                data[tier][pt] = {
                    "base_prices": doc.get("base_prices") or {},
                    "adder_prices": doc.get("adder_prices") or {},
                }
            else:
                # Caller still gets a complete shell even if seeding hasn't run.
                buckets = MEZZO_BUCKETS[pt]
                data[tier][pt] = {
                    "base_prices": {b["label"]: 0.0 for b in buckets},
                    "adder_prices": {
                        a: {b["label"]: 0.0 for b in buckets}
                        for a in MEZZO_ADDER_NAMES[pt]
                    },
                }
    return {
        "tiers": MEZZO_TIER_NAMES,
        "products": list(MEZZO_PRODUCT_TYPES.keys()),
        "buckets": {pt: MEZZO_BUCKETS[pt] for pt in MEZZO_PRODUCT_TYPES.keys()},
        "adders": {pt: MEZZO_ADDER_NAMES[pt] for pt in MEZZO_PRODUCT_TYPES.keys()},
        "data": data,
    }


@router.put("/admin/mezzo/prices")
async def admin_update_mezzo_prices(body: MezzoPriceUpdate, request: Request):
    """Update one (tier, product_type) grid. Unknown bucket/adder keys are
    silently dropped by save_prices()."""
    check_admin_token(request)
    if body.tier not in MEZZO_TIER_NAMES:
        raise HTTPException(status_code=400, detail=f"Unknown tier '{body.tier}'")
    if body.product_type not in MEZZO_PRODUCT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown product_type '{body.product_type}'")
    saved = await mezzo_prices.save_prices(
        body.tier, body.product_type, body.base_prices, body.adder_prices
    )
    return saved
