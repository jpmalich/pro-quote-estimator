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
import vero_prices
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

    # Iter 78q — TTL index on Phase 3 Deep Verify page cache (1 hour).
    # Auto-purges rendered elevation PNGs so we never accumulate stale
    # render data beyond a contractor's preview session.
    await db.hover_page_cache.create_index("cache_key")
    await db.hover_page_cache.create_index(
        "created_at", expireAfterSeconds=3600,
    )

    # Iter 79d — TTL index on HOVER async-import run docs (24 hours).
    # Each `/api/estimates/hover-import` POST inserts one doc that holds
    # the worker's status, stage, and (when done) the parsed result —
    # purged automatically a day after creation since the contractor
    # always retrieves the result within the polling window (max 5 min).
    await db.hover_import_runs.create_index("run_id", unique=True)
    await db.hover_import_runs.create_index(
        "created_at", expireAfterSeconds=86400,
    )

    # Iter 79e — same 24h TTL + unique run_id on the sibling async-run
    # collections so they don't accumulate forever. Each doc holds image
    # payloads + result objects (non-trivial size). Contractors always
    # poll the result inside the 5-min frontend window, so a day is more
    # than enough retention. Run docs include both AI Measure (photo
    # takeoffs) + AI Blueprint (PDF plan-sheet takeoffs).
    await db.ai_measure_runs.create_index("run_id", unique=True)
    await db.ai_measure_runs.create_index(
        "created_at", expireAfterSeconds=86400,
    )
    await db.ai_blueprint_runs.create_index("run_id", unique=True)
    await db.ai_blueprint_runs.create_index(
        "created_at", expireAfterSeconds=86400,
    )

    # Seed the 4 price tiers
    await ensure_tiers_seeded()

    # Seed Mezzo prices (idempotent) — fills in any missing (tier, product) docs
    # from the bundled JSON snapshot. Admin edits in Mongo are preserved.
    await db.mezzo_prices.create_index([("tier", 1), ("product_type", 1)], unique=True)
    await mezzo_prices.seed_mezzo_prices()

    # Seed Vero prices (same pattern — bundled JSON snapshot, idempotent).
    await vero_prices.ensure_indexes()
    await vero_prices.seed_vero_prices()
    # Iter 78y (2026-02-13): force-refresh Vero docs from the canonical
    # seed file every boot, AND drop product types / tiers that were
    # removed in the Iter 78y collapse. Running this AFTER the idempotent
    # seed means a fresh install is fast (seed populates, force refresh
    # is a no-op delta), and an upgrade applies Howard's new master file
    # without manual intervention.
    from vero_catalog import VERO_PRODUCT_TYPES, VERO_TIER_NAMES
    OBSOLETE_VERO_PRODUCTS = ["Vero 3-Lite Slider", "Vero Picture"]
    OBSOLETE_VERO_TIERS = ["one-opp"]
    await db.vero_prices.delete_many(
        {"product_type": {"$in": OBSOLETE_VERO_PRODUCTS}}
    )
    await db.vero_prices.delete_many(
        {"tier": {"$in": OBSOLETE_VERO_TIERS}}
    )
    # Force overwrite the 3×3 active (tier, product) docs with the
    # canonical seed values so the new pricing lands immediately.
    await vero_prices.seed_vero_prices(force=True)

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
