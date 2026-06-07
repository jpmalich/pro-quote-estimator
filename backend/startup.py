"""Startup tasks: DB indexes, tier/admin seeding, schema migrations."""
import uuid
from datetime import datetime, timezone

from config import (
    ADMIN_COMPANY,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    SUPPLIER_ADMIN_TOKEN,
)
import mezzo_prices
from db import db, logger
from deps import hash_password, verify_password
from services import create_company, ensure_tiers_seeded, get_default_tier_id


async def run_startup():
    # Indexes
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
    await ensure_tiers_seeded()

    # Seed Mezzo prices (idempotent) — fills in any missing (tier, product) docs
    # from the bundled JSON snapshot. Admin edits in Mongo are preserved.
    await db.mezzo_prices.create_index([("tier", 1), ("product_type", 1)], unique=True)
    await mezzo_prices.seed_mezzo_prices()

    # Migrate old catalog docs that still have `sections` -> convert to empty overrides
    # (material now comes from tier; we keep their labor if it differed by storing as override).
    legacy_cats = db.catalogs.find({"sections": {"$exists": True}})
    async for legacy in legacy_cats:
        await db.catalogs.update_one(
            {"_id": legacy["_id"]},
            {"$unset": {"sections": ""}, "$set": {"overrides": legacy.get("overrides", {})}},
        )

    # Migrate old global catalog (id="default") -> remove
    legacy = await db.catalogs.find_one({"id": "default"})
    if legacy:
        await db.catalogs.delete_one({"id": "default"})

    # Seed admin user
    admin = await db.users.find_one({"email": ADMIN_EMAIL.lower()})
    admin_id = admin["id"] if admin else str(uuid.uuid4())

    # Ensure admin's company exists
    admin_company = None
    if admin and admin.get("company_id"):
        admin_company = await db.companies.find_one({"id": admin["company_id"]})
    if not admin_company:
        admin_company = await create_company(ADMIN_COMPANY, admin_id)

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
    default_tier_id = await get_default_tier_id()
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
