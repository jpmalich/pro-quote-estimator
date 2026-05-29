"""Domain helpers reused by routes AND startup migrations.

Keeping these in a single module prevents circular imports between
routes/* (which need them at request time) and startup.py (which
needs them during the initial seed/migration).
"""
import uuid
from datetime import datetime, timezone

from config import SUPPLIER_NAME, SUPPLIER_TAGLINE
from db import db, logger
from deps import make_invite_code
from catalog_seed import TIER_NAMES, DEFAULT_TIER_NAME, build_tier_sections, ITEM_AMI, TIER_PRICES


# ---------------------------------------------------------------------------
# Branding (settings singleton)
# ---------------------------------------------------------------------------
async def get_branding() -> dict:
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


# ---------------------------------------------------------------------------
# Price tiers
# ---------------------------------------------------------------------------
async def ensure_tiers_seeded():
    """Seed the 4 standard price tiers if they don't exist yet.
    Also runs a tiny in-place migration to backfill `ami_part` on existing tier
    docs that were seeded before AMI numbers existed in the catalog."""
    # One-time rename: "Install Vinyl Siding" → "Vinyl Siding" (Iter 24).
    # Done up front so the rest of the migration logic below (which matches
    # sections by title) finds the renamed section instead of orphaning it.
    await db.price_tiers.update_many(
        {"sections.title": "Install Vinyl Siding"},
        {"$set": {"sections.$[s].title": "Vinyl Siding"}},
        array_filters=[{"s.title": "Install Vinyl Siding"}],
    )
    # Same rename applied to historical estimate line items so existing
    # estimates keep matching their catalog source after the rename.
    await db.estimates.update_many(
        {"lines.section": "Install Vinyl Siding"},
        {"$set": {"lines.$[l].section": "Vinyl Siding"}},
        array_filters=[{"l.section": "Install Vinyl Siding"}],
    )
    # Iter 26: rename "Ascend - 5.5\" H Channel  (16' length)" → "Ascend - 5.5\" Trim  (16' length)"
    # in both tier docs AND historical estimate line items.
    H_CHANNEL = "Ascend - 5.5\" H Channel  (16' length)"
    TRIM = "Ascend - 5.5\" Trim  (16' length)"
    await db.price_tiers.update_many(
        {"sections.items.name": H_CHANNEL},
        {"$set": {"sections.$[].items.$[it].name": TRIM}},
        array_filters=[{"it.name": H_CHANNEL}],
    )
    await db.estimates.update_many(
        {"lines.name": H_CHANNEL},
        {"$set": {"lines.$[l].name": TRIM}},
        array_filters=[{"l.name": H_CHANNEL}],
    )
    # Iter 26 follow-up: the catalog_seed update + section-rebuild migration
    # raced on first reload — Trim/ASCEND Finish Trim/Ascend - Starter landed
    # in DB at $0 because TIER_PRICES wasn't fully populated yet. Backfill the
    # correct mat prices from TIER_PRICES, idempotent (only updates items that
    # are currently $0 and have a real price in TIER_PRICES).
    # Iter 27: drop the "(1 per 50' fascia)" suffix from the 3 siding-accessories
    # coil entries — the fascia variants now live in Vinyl Soffit with Siding as
    # separate items, so the Siding Accessories names should just describe their
    # one usage. Rename in tier docs + historical estimate line items.
    COIL_RENAMES = [
        (".019 Coil (1 per 5 Sq Siding) (1 per 50' fascia)",
         ".019 Coil (1 per 5 Sq Siding)"),
        ("PVC Trim Coil (1 per 5 Sq Siding) (1 per 50' fascia)",
         "PVC Trim Coil (1 per 5 Sq Siding)"),
        ("Performance G8 Trim Coil (1 per 5 Sq Siding) (1 per 50' fascia)",
         "Performance G8 Trim Coil (1 per 5 Sq Siding)"),
    ]
    for old_name, new_name in COIL_RENAMES:
        await db.price_tiers.update_many(
            {"sections.items.name": old_name},
            {"$set": {"sections.$[].items.$[it].name": new_name}},
            array_filters=[{"it.name": old_name}],
        )
        await db.estimates.update_many(
            {"lines.name": old_name},
            {"$set": {"lines.$[l].name": new_name}},
            array_filters=[{"l.name": old_name}],
        )
    BACKFILL = [
        TRIM, "ASCEND Finish Trim", "Ascend - Starter",
        ".019 Coil (1 per 50' fascia)",
        "PVC Trim Coil (1 per 50' fascia)",
        "Performance G8 Trim Coil (1 per 50' fascia)",
    ]
    async for tier in db.price_tiers.find({}, {"_id": 0, "id": 1, "name": 1, "sections": 1}):
        prices = TIER_PRICES.get(tier["name"])
        if not prices:
            continue
        sections = tier.get("sections") or []
        changed = False
        for sec in sections:
            for it in sec.get("items", []) or []:
                if it.get("name") in BACKFILL and float(it.get("mat") or 0) == 0:
                    want = float(prices.get(it["name"], 0))
                    if want > 0:
                        it["mat"] = want
                        changed = True
        if changed:
            await db.price_tiers.update_one(
                {"id": tier["id"]},
                {"$set": {"sections": sections,
                          "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            logger.info("Backfilled Ascend prices on tier %s", tier["name"])
    existing = {t["name"] async for t in db.price_tiers.find({}, {"name": 1})}
    for name in TIER_NAMES:
        if name not in existing:
            now = datetime.now(timezone.utc).isoformat()
            await db.price_tiers.insert_one({
                "id": str(uuid.uuid4()),
                "name": name,
                "sections": build_tier_sections(name),
                "created_at": now,
                "updated_at": now,
            })
            logger.info("Seeded price tier %s", name)

    # Migrate existing tier docs whenever SECTION_LAYOUT changes shape.
    # We compare the item list inside "Vinyl Siding" — if it differs
    # from the latest seed (e.g. siding was split into 12 profiles), rebuild
    # JUST that section using the fresh tier prices, preserving every other
    # section (so contractor labor overrides on other categories survive).
    fresh_by_name = {name: build_tier_sections(name) for name in TIER_NAMES}
    async for tier in db.price_tiers.find({}, {"_id": 0, "id": 1, "name": 1, "sections": 1}):
        fresh = fresh_by_name.get(tier["name"])
        if not fresh:
            continue
        sections = tier.get("sections") or []
        dirty = False
        for i, sec in enumerate(sections):
            fresh_sec = next((s for s in fresh if s["title"] == sec["title"]), None)
            if not fresh_sec:
                continue
            current_items = {it.get("name") for it in sec.get("items", [])}
            fresh_items = {it["name"] for it in fresh_sec["items"]}
            if current_items != fresh_items:
                # Item set diverged — replace the whole section with fresh data
                logger.info(
                    "Rebuilding section %s on tier %s (added=%s removed=%s)",
                    sec["title"], tier["name"],
                    sorted(fresh_items - current_items),
                    sorted(current_items - fresh_items),
                )
                sections[i] = fresh_sec
                dirty = True
            else:
                # Same item set — just backfill ami_part on each item
                for item in sec.get("items", []):
                    want = ITEM_AMI.get(item.get("name"))
                    if want and item.get("ami_part") != want:
                        item["ami_part"] = want
                        dirty = True
        if dirty:
            await db.price_tiers.update_one(
                {"id": tier["id"]},
                {"$set": {"sections": sections, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            logger.info("Updated tier %s with latest catalog structure", tier["name"])


async def get_default_tier_id() -> str | None:
    t = await db.price_tiers.find_one({"name": DEFAULT_TIER_NAME}, {"id": 1})
    return t["id"] if t else None


# ---------------------------------------------------------------------------
# Companies
# ---------------------------------------------------------------------------
async def create_company(name: str, owner_user_id: str) -> dict:
    tier_id = await get_default_tier_id()
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


# ---------------------------------------------------------------------------
# Estimate totals (shared by CSV export + future PDF generator)
# ---------------------------------------------------------------------------
def calc_totals(est: dict) -> dict:
    lines = est.get("lines", []) or []
    misc_labor = est.get("misc_labor", []) or []
    misc_material = est.get("misc_material", []) or []
    sub_mat = (
        sum((ln.get("qty", 0) or 0) * (ln.get("mat", 0) or 0) for ln in lines)
        + sum((m.get("mat", 0) or 0) for m in misc_material)
    )
    sub_lab = (
        sum((ln.get("qty", 0) or 0) * (ln.get("lab", 0) or 0) for ln in lines)
        + sum((m.get("lab", 0) or 0) for m in misc_material)
        + sum((m.get("lab", 0) or 0) for m in misc_labor)
    )
    # Waste factor inflates only the actual siding material (cut-offs from
    # panel cuts). Trim, accessories, soffit, gutter, etc. are ordered to
    # actual count and should not be padded. Ascend Composite Lap + B&B are
    # treated as siding material alongside the Vinyl Siding section.
    WASTE_ASCEND = {
        "Ascend Composite Lap Siding 7\"",
        "Ascend Composite B&B 12\" (add 30% Waste)",
    }
    def _is_waste_line(ln: dict) -> bool:
        if ln.get("section") == "Vinyl Siding":
            return True
        return (ln.get("section") == "Ascend Cladding/Accessories"
                and ln.get("name") in WASTE_ASCEND)
    waste_base = sum(
        (ln.get("qty", 0) or 0) * (ln.get("mat", 0) or 0)
        for ln in lines if _is_waste_line(ln)
    )
    waste_add = waste_base * ((est.get("waste_pct", 0) or 0) / 100)
    wasted = sub_mat + waste_add
    tax = wasted * ((est.get("tax_rate", 0) or 0) / 100) if est.get("tax_enabled") else 0
    base = wasted + tax + sub_lab
    pct = (est.get("margin_pct", 0) or 0) / 100
    # Legacy estimates without pricing_mode were created under the old markup behaviour.
    mode = est.get("pricing_mode") or "markup"
    if mode == "margin":
        denom = 1 - min(pct, 0.99)  # cap to avoid divide-by-zero
        sell = base / denom if denom > 0 else base
    else:
        sell = base * (1 + pct)
    profit = sell - base
    return {
        "sub_mat": sub_mat, "sub_lab": sub_lab,
        "wasted": wasted, "tax": tax,
        "base": base, "sell": sell, "profit": profit,
    }
