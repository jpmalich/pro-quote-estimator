"""Domain helpers reused by routes AND startup migrations.

Keeping these in a single module prevents circular imports between
routes/* (which need them at request time) and startup.py (which
needs them during the initial seed/migration).
"""
import uuid
import math
from datetime import datetime, timezone

from config import SUPPLIER_NAME, SUPPLIER_TAGLINE
from db import db, logger
from deps import make_invite_code
from catalog_seed import (
    DEFAULT_TIER_NAME, TIER_NAMES, build_tier_sections,
    ITEM_AMI, ITEM_META, TIER_PRICES, product_lines_for,
)


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
    # Iter 23 (LP era): the 2 Ascend siding items (Composite Lap & Composite
    # B&B) moved out of "Ascend Cladding/Accessories" into their own new
    # "Ascend Cladding" section. Re-tag historical estimate line items so
    # existing quotes keep matching their catalog source after the split.
    ASCEND_SIDING_NAMES = [
        'Ascend Composite Lap Siding 7"',
        'Ascend Composite B&B 12" (add 30% Waste)',
    ]
    await db.estimates.update_many(
        {"lines": {"$elemMatch": {
            "section": "Ascend Cladding/Accessories",
            "name": {"$in": ASCEND_SIDING_NAMES},
        }}},
        {"$set": {"lines.$[el].section": "Ascend Cladding"}},
        array_filters=[{
            "el.section": "Ascend Cladding/Accessories",
            "el.name": {"$in": ASCEND_SIDING_NAMES},
        }],
    )
    # Iter 30: "New Exterior Coil Trim" moved from "Window Exterior Trim
    # Work" → "Window Installation". Re-tag any saved estimate lines that
    # still reference the old section so saved-qty / overrides round-trip.
    await db.estimates.update_many(
        {"lines": {"$elemMatch": {
            "section": "Window Exterior Trim Work",
            "name": "New Exterior Coil Trim",
        }}},
        {"$set": {"lines.$[el].section": "Window Installation"}},
        array_filters=[{
            "el.section": "Window Exterior Trim Work",
            "el.name": "New Exterior Coil Trim",
        }],
    )
    # Iter 31: "New Exterior Coil Trim" → "Cap window (Windows)" rename.
    # The "(Windows)" suffix disambiguates from the existing "Cap window"
    # item in the siding-tab Misc. Labor & Material section. Rename in
    # tier_doc items AND historical estimate lines so saved estimates
    # continue to merge against the catalog correctly.
    await db.price_tiers.update_many(
        {"sections.items.name": "New Exterior Coil Trim"},
        {"$set": {"sections.$[].items.$[it].name": "Cap window (Windows)"}},
        array_filters=[{"it.name": "New Exterior Coil Trim"}],
    )
    await db.estimates.update_many(
        {"lines.name": "New Exterior Coil Trim"},
        {"$set": {"lines.$[l].name": "Cap window (Windows)"}},
        array_filters=[{"l.name": "New Exterior Coil Trim"}],
    )
    # Iter 32: Job Measure Standard Fee + Disposal Fee moved from
    # "Window Misc." → "Window Installation". Re-tag historical lines.
    WINDOW_INSTALL_MOVE = [
        "Job Measure Standard Fee 4 days+",
        "Disposal Fee (Windows)",
        # Iter 33
        "Mullion Removal & Cut-Out of Non-Structural Framing Members",
    ]
    await db.estimates.update_many(
        {"lines": {"$elemMatch": {
            "section": "Window Misc.",
            "name": {"$in": WINDOW_INSTALL_MOVE},
        }}},
        {"$set": {"lines.$[el].section": "Window Installation"}},
        array_filters=[{
            "el.section": "Window Misc.",
            "el.name": {"$in": WINDOW_INSTALL_MOVE},
        }],
    )
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
    # Iter 36: 'Fascia/rake or frieze up to 8" coverage' moved from
    # PER_TIER_PRICES → ZERO_PRICED (Howard: mat should be $0.00 across all
    # tiers; this is a labor-only line). Force-set mat=0 on any existing
    # tier doc that still carries the old non-zero price. Idempotent: once
    # all 4 tiers have mat=0 for this row, the matcher finds nothing on
    # subsequent boots.
    await db.price_tiers.update_many(
        {"sections.items": {"$elemMatch": {
            "name": 'Fascia/rake or frieze up to 8" coverage',
            "mat": {"$ne": 0},
        }}},
        {"$set": {"sections.$[].items.$[it].mat": 0.0}},
        array_filters=[{"it.name": 'Fascia/rake or frieze up to 8" coverage'}],
    )
    # Iter 65: 'End Cap' added to Seamless Gutter at $2.08 on all tiers.
    # The first hot-reload after the catalog edit landed inserted the row
    # at mat=$0 (price wasn't in IDENTICAL_PRICES yet at that snapshot).
    # Force-set mat=$2.08 on any tier doc still carrying $0 for End Cap.
    # Idempotent: matcher finds nothing once all 4 tiers are at $2.08.
    await db.price_tiers.update_many(
        {"sections.items": {"$elemMatch": {
            "name": "End Cap",
            "mat": {"$ne": 2.08},
        }}},
        {"$set": {"sections.$[].items.$[it].mat": 2.08}},
        array_filters=[{"it.name": "End Cap"}],
    )
    # Iter 36: window catalog restructured into per-product-type sections
    # (Vero Double Hung / 2 Lite Slider / 3 Lite Slider / Casement /
    # Picture) plus a new "Window Material List" section. The old umbrella
    # "Vero Windows" and "Window Upgrade Options" sections are gone. Pull
    # them out of every existing tier doc so they don't ghost-render in
    # the UI (build_tier_sections() generates the replacement set, which
    # the existing append-new-sections loop below picks up). Also wipe any
    # historical estimate lines that referenced those obsolete sections —
    # user confirmed this is pre-production test data and old window rows
    # are safe to drop.
    OBSOLETE_WINDOW_SECTIONS = ["Vero Windows", "Window Upgrade Options"]
    await db.price_tiers.update_many(
        {"sections.title": {"$in": OBSOLETE_WINDOW_SECTIONS}},
        {"$pull": {"sections": {"title": {"$in": OBSOLETE_WINDOW_SECTIONS}}}},
    )
    await db.estimates.update_many(
        {"lines.section": {"$in": OBSOLETE_WINDOW_SECTIONS}},
        {"$pull": {"lines": {"section": {"$in": OBSOLETE_WINDOW_SECTIONS}}}},
    )
    # Also wipe stale lines that referenced the OLD Vero size buckets
    # (e.g. "Vero - 3 lite slider 0-45 UI") — none of these names exist in
    # the new layout, so any saved estimate line carrying one would just
    # produce a ghost row in the editor. Bounded list so we don't touch
    # the renamed-but-still-valid Double Hung / Slider 0-101 UI rows.
    OBSOLETE_WINDOW_ITEMS = [
        "Vero - 3 lite slider 0-45 UI",
        "Vero - 3 lite slider 46-70 UI",
        "Vero - 3 lite slider 71-101 UI",
        "Vero - Casement 0-45 UI",
        "Vero - Casement 46-70 UI",
        "Vero - Casement 71-101 UI",
        "Vero - Picture 0-45 UI",
        "Vero - Picture 46-70 UI",
        "Vero - Picture 71-101 UI",
        "Window Package Price",
        "Climatech TG2 Triple Pane .19 U Factor 2 coats LoE",
        "Sentry System - Tilt Lock upgrade",
        "Integral Nail Fin 0-101",
        "Heavy Duty 1/2 Screen White ONLY",
        # Renamed install line
        "Window - Pocket Install",
        # Renamed door rows
        "Vinyl Sliding Glass Door (8' width or field assembled)",
        "Oversize Vinyl Door (greater than 8' width)",
        # Renamed interior trim row
        "New Interior Sill - create or replace (QUOTE ONLY)",
        # Removed coil trim from Window Installation (it duplicated Cap window)
        "New Exterior Coil Trim",
    ]
    await db.estimates.update_many(
        {"lines.name": {"$in": OBSOLETE_WINDOW_ITEMS}},
        {"$pull": {"lines": {"name": {"$in": OBSOLETE_WINDOW_ITEMS}}}},
    )
    # Iter 36 follow-up: an earlier boot snapshotted `Vero - Double Hung
    # 0-101 UI` at its old $294.55 wholesale price into the new "Vero
    # Double Hung Windows" section before Howard's "reset all window
    # prices to $0" decision landed. Force-set mat=0 for that one row so
    # the new layout starts truly clean. Idempotent: subsequent boots
    # find mat already 0 and skip the write.
    await db.price_tiers.update_many(
        {"sections.items": {"$elemMatch": {
            "name": "Vero - Double Hung 0-101 UI",
            "mat": {"$ne": 0},
        }}},
        {"$set": {"sections.$[].items.$[it].mat": 0.0}},
        array_filters=[{"it.name": "Vero - Double Hung 0-101 UI"}],
    )
    # Iter 43: Howard wants all default labor on Vinyl + Ascend lines to be
    # $0 so contractors fill in labor per job. Zero `lab` on every item that
    # belongs ONLY to vinyl/ascend (and shared lp_smart) sections — leave
    # the Windows tab labor alone since those defaults come from the Excel
    # and contractors expect them. Idempotent: only writes when lab != 0.
    VINYL_ASCEND_ITEM_NAMES = []
    for name, (_unit, lab_default) in ITEM_META.items():
        # Skip window-tab items — they're identified by either a "(Windows)"
        # suffix, a "Vero" prefix, or by appearing in a Windows section.
        if name.startswith("Vero") or "(Windows)" in name or name.startswith("Windows -"):
            continue
        # Skip the few window-only entries that don't follow the naming
        # convention above.
        if name in {
            "Window DH/Slider - Pocket Install",
            "Window - Full Fin Replacement",
            "Large Window - adder for windows 30 sq-ft or larger",
            "Field Mull Assembly and/or Field Glaze (adder per each opening)",
            "Lead Safe Installation Practices For Window Installation",
            "Lead Safe - Test Fee (all homes 1978 and older are tested)",
            "Vinyl Sliding Glass Door (5' & 6' width)",
            "Vinyl Sliding Glass Door (8' width -or- a sliding door that needs to be field assembled)",
            "Oversize Vinyl Door - (greater than 8' width)",
            "New Exterior Primed Stops or Snap Trim",
            "New Exterior Primed Wood Trim",
            "New Exterior Composite Trim",
            "New Interior Stops or Flat Trim",
            "New Interior Casing",
            "New Interior Jamb Extension",
            "New Interior Sill - create or replace interior window sill - QUOTE ONLY",
            "Interior Blinds - Remove For Window Install & Reinstall",
            "Mullion Removal & Cut-Out of Non-Structural Framing Members",
            "Second/Third/Clear Story Fee",
            "Job Measure Standard Fee 4 days+",
            "Job Measure Rush Fee 3 days or less",
            "Add New Channel on ALL, Close up opening to match master Front opening",
            "Minimum Job Charge For Window Installs",
            "Disposal Fee (Windows)",
            "Shutters - Take Down & Put Up (REUSE EXISTING ONLY)",
            "Storm Window Removal",
        }:
            continue
        if lab_default != 0:
            continue  # only need to clear ITEM_META-zero rows; but keep below to clear DB too
        VINYL_ASCEND_ITEM_NAMES.append(name)
    # Build the full set of every name we just zeroed in ITEM_META so the
    # DB migration matches both — items that were already 0 and items we
    # newly zeroed (since the source file now reads 0 for both).
    if VINYL_ASCEND_ITEM_NAMES:
        await db.price_tiers.update_many(
            {"sections.items": {"$elemMatch": {
                "name": {"$in": VINYL_ASCEND_ITEM_NAMES},
                "lab": {"$ne": 0},
            }}},
            {"$set": {"sections.$[].items.$[it].lab": 0.0}},
            array_filters=[{"it.name": {"$in": VINYL_ASCEND_ITEM_NAMES}}],
        )
    # Iter 44: split the legacy "J-blocks, Dryer vents" rollup into 4 SKUs
    # (Split/Light/UL/Jumbo). Idempotent migration: pull the old name and
    # push the 4 new lines into the Siding Accessories section on every
    # tier doc. Existing estimates keep their snapshot of the old line.
    # Iter 44b: name shortened from "J-blocks, Dryer vents - X" to "J-blocks - X"
    # per supplier preference — rename any pre-existing rows in place.
    JBLOCK_RENAMES = {
        "J-blocks, Dryer vents - Split Blocks (82A009)": "J-blocks - Split Blocks (82A009)",
        "J-blocks, Dryer vents - Light Blocks (82A010)": "J-blocks - Light Blocks (82A010)",
        "J-blocks, Dryer vents - UL Blocks (82A017)":    "J-blocks - UL Blocks (82A017)",
        "J-blocks, Dryer vents - Jumbo Blocks (82A011)": "J-blocks - Jumbo Blocks (82A011)",
    }
    for old_name, new_name in JBLOCK_RENAMES.items():
        await db.price_tiers.update_many(
            {"sections.items.name": old_name},
            {"$set": {"sections.$[].items.$[it].name": new_name}},
            array_filters=[{"it.name": old_name}],
        )
    NEW_J_BLOCK_ITEMS = [
        {"name": "J-blocks - Split Blocks (82A009)",  "unit": "Each", "mat": 13.49, "lab": 0.0, "ami_part": "82A009"},
        {"name": "J-blocks - Light Blocks (82A010)",  "unit": "Each", "mat": 11.72, "lab": 0.0, "ami_part": "82A010"},
        {"name": "J-blocks - UL Blocks (82A017)",     "unit": "Each", "mat": 21.51, "lab": 0.0, "ami_part": "82A017"},
        {"name": "J-blocks - Jumbo Blocks (82A011)",  "unit": "Each", "mat": 11.72, "lab": 0.0, "ami_part": "82A011"},
        {"name": 'Dryer Vents 4" (82A014)',           "unit": "Each", "mat": 23.81, "lab": 0.0, "ami_part": "82A014"},
    ]
    new_names = {it["name"] for it in NEW_J_BLOCK_ITEMS}
    async for doc in db.price_tiers.find({}, {"sections": 1}):
        sections = doc.get("sections", [])
        dirty = False
        for sec in sections:
            if sec.get("title") != "Siding Accessories":
                continue
            items = sec.get("items", [])
            # Drop the legacy rollup line.
            before = len(items)
            items = [it for it in items if it.get("name") != "J-blocks, Dryer vents"]
            if len(items) != before:
                dirty = True
            # Add the 4 new lines if missing (idempotent across reseeds).
            existing = {it.get("name") for it in items}
            for it in NEW_J_BLOCK_ITEMS:
                if it["name"] not in existing:
                    items.append(it)
                    dirty = True
            sec["items"] = items
        if dirty:
            await db.price_tiers.update_one({"_id": doc["_id"]}, {"$set": {"sections": sections}})
    del new_names
    # Force-sync mat on the 4 new J-block items so a previous botched
    # migration (with $0 mat) gets corrected. Idempotent — only writes when
    # the DB value disagrees with the supplier-confirmed price.
    J_BLOCK_PRICES = {
        "J-blocks - Split Blocks (82A009)": 13.49,
        "J-blocks - Light Blocks (82A010)": 11.72,
        "J-blocks - UL Blocks (82A017)": 21.51,
        "J-blocks - Jumbo Blocks (82A011)": 11.72,
        'Dryer Vents 4" (82A014)': 23.81,
    }
    for jname, jprice in J_BLOCK_PRICES.items():
        await db.price_tiers.update_many(
            {"sections.items": {"$elemMatch": {"name": jname, "mat": {"$ne": jprice}}}},
            {"$set": {"sections.$[].items.$[it].mat": float(jprice)}},
            array_filters=[{"it.name": jname}],
        )
    # ------------------------------------------------------------------
    # Iter 45: Soffit & fascia LF → PCS conversion.
    #
    # Howard's pricing convention puts per-piece prices into the sheet
    # divided by 10 (uniform across all 4 SKUs), so the LF→PCS swap is
    # qty/10 + mat*10, which preserves dollar totals on every existing
    # estimate. The legacy "13"-30" wide" wide-soffit variants are
    # dropped entirely — they were never auto-populated and Howard
    # decided wider soffits get the same SKU at a higher overhang.
    # ------------------------------------------------------------------
    SOFFIT_RENAMES = {
        'Soffit & fascia up to 13" wide Charter Oak Standard color': "Charter Oak Soffit Standard color",
        'Soffit & fascia up to 13" wide Charter Oak Architectural color': "Charter Oak Soffit Architectural color",
        'Soffit & fascia up to 13" wide Greenbriar': "Greenbriar Soffit",
        'Soffit & fascia up to 13" T2': "T2 Soffit",
    }
    SOFFIT_DROPS = [
        'Soffit & fascia up to 13"-30" wide Charter Oak Standard color',
        'Soffit & fascia up to 13"-30" wide Charter Oak Architectural color',
        'Soffit & fascia up to 13"-30" wide Greenbriar',
        'Soffit & fascia up to 13"-30" T2',
    ]
    # 1) DROP wide variants from every tier's Vinyl Soffit section.
    await db.price_tiers.update_many(
        {"sections.items.name": {"$in": SOFFIT_DROPS}},
        {"$pull": {"sections.$[].items": {"name": {"$in": SOFFIT_DROPS}}}},
    )
    # 2) Rename narrow variants in-place and flip unit LF → PCS,
    #    multiplying mat by 10. Done as 4 targeted update_many calls
    #    (one per SKU) so we can set a per-SKU new mat without
    #    fighting Mongo positional operators.
    for old_name, new_name in SOFFIT_RENAMES.items():
        await db.price_tiers.update_many(
            {"sections.items.name": old_name},
            {
                "$set": {
                    "sections.$[].items.$[it].name": new_name,
                    "sections.$[].items.$[it].unit": "PCS",
                }
            },
            array_filters=[{"it.name": old_name}],
        )
        # mat × 10 (per Howard's pricing convention).
        async for doc in db.price_tiers.find(
            {"sections.items.name": new_name}, {"sections": 1}
        ):
            dirty = False
            sections = doc.get("sections", [])
            for sec in sections:
                for it in sec.get("items", []):
                    if it.get("name") == new_name and it.get("unit") != "LF":
                        # Only bump if mat looks "small" (per-LF range),
                        # otherwise it's already been migrated.
                        cur = float(it.get("mat") or 0)
                        if 0 < cur < 5:
                            it["mat"] = round(cur * 10, 2)
                            dirty = True
            if dirty:
                await db.price_tiers.update_one(
                    {"_id": doc["_id"]}, {"$set": {"sections": sections}}
                )
    # 3) Estimate-line migration: rename old names, change unit, divide
    #    qty by 10 (one-shot, idempotent — only acts when unit is still
    #    "LF"). Drop any lines that point at the wide-variant SKUs since
    #    those are gone from the catalog.
    await db.estimates.update_many(
        {"lines.name": {"$in": SOFFIT_DROPS}},
        {"$pull": {"lines": {"name": {"$in": SOFFIT_DROPS}}}},
    )
    for old_name, new_name in SOFFIT_RENAMES.items():
        async for est in db.estimates.find(
            {"lines.name": old_name}, {"lines": 1}
        ):
            lines = est.get("lines", [])
            dirty = False
            for ln in lines:
                if ln.get("name") != old_name:
                    continue
                ln["name"] = new_name
                if ln.get("unit") == "LF":
                    ln["unit"] = "PCS"
                    ln["qty"] = max(1, round(float(ln.get("qty") or 0) / 10))
                    ln["mat"] = round(float(ln.get("mat") or 0) * 10, 2)
                    dirty = True
            if dirty:
                await db.estimates.update_one(
                    {"_id": est["_id"]}, {"$set": {"lines": lines}}
                )

    # ------------------------------------------------------------------
    # Iter 46: Soffit J-Channel LF → PCS (same names, just unit + math).
    # Pricing now matches Vinyl Accessories J-Channel ($5.23/$6.03 per
    # piece across tiers). qty conversion: qty_pcs = ceil(qty_lf / 12.5)
    # since J-channel ships in 12'6" sticks. Catalog mat is force-set
    # below to the new per-piece prices; estimate-line mat keeps its
    # current dollar value (contractors may have overridden).
    # ------------------------------------------------------------------
    SOFFIT_J_NEW_PRICES = {
        '3/4" Soffit J-Channel (Charter Oak) Standard color':
            {"whole-sale": 7.28, "Contractor": 5.23, "Builder-Dealer": 5.23, "one-opp": 4.55},
        '3/4" Soffit J-Channel (Charter Oak) Architectural color':
            {"whole-sale": 8.49, "Contractor": 6.03, "Builder-Dealer": 6.03, "one-opp": 4.55},
        '1/2" Soffit J-Channel (for T2 Soffit)':
            {"whole-sale": 7.28, "Contractor": 5.23, "Builder-Dealer": 5.23, "one-opp": 4.55},
    }
    # Catalog: flip unit + set new PCS price per tier.
    async for tier in db.price_tiers.find({}, {"_id": 1, "name": 1, "sections": 1}):
        tier_name = tier.get("name")
        sections = tier.get("sections") or []
        dirty = False
        for sec in sections:
            for it in sec.get("items", []) or []:
                name = it.get("name")
                if name in SOFFIT_J_NEW_PRICES:
                    new_price = float(SOFFIT_J_NEW_PRICES[name].get(tier_name, 0))
                    if it.get("unit") != "PCS" or float(it.get("mat") or 0) != new_price:
                        it["unit"] = "PCS"
                        if new_price > 0:
                            it["mat"] = new_price
                        dirty = True
        if dirty:
            await db.price_tiers.update_one(
                {"_id": tier["_id"]}, {"$set": {"sections": sections}}
            )
    # Estimate lines: flip unit + divide qty by 12.5, ceil.
    SOFFIT_J_NAMES = list(SOFFIT_J_NEW_PRICES.keys())
    async for est in db.estimates.find(
        {"lines.name": {"$in": SOFFIT_J_NAMES}}, {"lines": 1}
    ):
        lines = est.get("lines", [])
        dirty = False
        for ln in lines:
            if ln.get("name") in SOFFIT_J_NAMES and ln.get("unit") == "LF":
                ln["unit"] = "PCS"
                ln["qty"] = max(1, math.ceil(float(ln.get("qty") or 0) / 12.5))
                dirty = True
        if dirty:
            await db.estimates.update_one(
                {"_id": est["_id"]}, {"$set": {"lines": lines}}
            )

    BACKFILL = [
        TRIM, "ASCEND Finish Trim", "Ascend - Starter",
        ".019 Coil (1 per 50' fascia)",
        "PVC Trim Coil (1 per 50' fascia)",
        "Performance G8 Trim Coil (1 per 50' fascia)",
        # Iter 34: Standard/Architectural color variants — backfill mat for
        # any variant currently sitting at $0 (which happens when an earlier
        # hot-reload race rebuilt the section with the new names but the
        # then-current TIER_PRICES didn't yet have the new entries). Bounded
        # to the new variant names so it can't touch any unrelated item.
        # Vinyl Siding
        'Conquest Standard color Clap 4.5" .040',
        'Conquest Standard color Dutch lap 4.5" .040',
        'Conquest Architectural color Clap 4.5" .040',
        'Conquest Architectural color Dutch lap 4.5" .040',
        'Coventry Standard color Clap 4" .042',
        'Coventry Standard color Dutch lap 4" .042',
        'Coventry Architectural color Clap 4" .042',
        'Coventry Architectural color Dutch lap 4" .042',
        'Coventry Standard color Clap 5" .042',
        'Coventry Standard color Dutch lap 5" .042',
        'Coventry Architectural color Clap 5" .042',
        'Coventry Architectural color Dutch lap 5" .042',
        'Odyssey Standard color Clap 4" .044',
        'Odyssey Standard color Dutch Lap 4" .044',
        'Odyssey Architectural color Clap 4" .044',
        'Odyssey Architectural color Dutch Lap 4" .044',
        'Odyssey Standard color Clap 5" .044',
        'Odyssey Standard color Dutch Lap 5" .044',
        'Odyssey Architectural color Clap 5" .044',
        'Odyssey Architectural color Dutch Lap 5" .044',
        'Charter Oak Standard color Clap 4.5" .046',
        'Charter Oak Standard color Dutch Lap 4.5" .046',
        'Charter Oak Architectural color Clap 4.5" .046',
        'Charter Oak Architectural color Dutch Lap 4.5" .046',
        'vertical board and batten Standard color 7"',
        'vertical board and batten Architectural color 7"',
        # Siding Accessories
        "Outside corners Standard color",
        "Outside corners Architectural color",
        "Inside Corners (Siding) Standard color",
        "Inside Corners (Siding) Architectural color",
        '3/4" J-Channel Standard color (2 per Sq of siding)',
        '3/4" J-Channel Architectural color (2 per Sq of siding)',
        "Finish Trim Standard color",
        "Finish Trim Architectural color",
        # Vinyl Soffit with Siding — Iter 45: renamed and converted to PCS
        'Charter Oak Soffit Standard color',
        'Charter Oak Soffit Architectural color',
        'Greenbriar Soffit',
        'T2 Soffit',
        '3/4" Soffit J-Channel (Charter Oak) Standard color',
        '3/4" Soffit J-Channel (Charter Oak) Architectural color',
    ]
    # Iter 67 (2026-06-22): LP SmartSide renamed to supplier-spec names + units
    # consolidated to PCS-only (Howard's "I want only pcs pricing" + new
    # supplier price sheet). Migrations applied at boot:
    #   1. Rename 19 LP items in tier docs + estimate lines.
    #   2. Flip 11 trim items LF → PCS and convert saved qty: ceil(LF / 16).
    #   3. Flip the 8" Lap row SQ → PCS and convert saved qty: round(SQ × 11).
    #   4. Drop "LP Color Match Coil" — replaced by 3 vinyl-matching coils.
    # Each step is idempotent — second boot finds nothing to do.
    LP_RENAME_MAP = {
        # Lap / Shake / Nickel Gap / Panels
        'LP Strand Lap Siding 3/8" x 8" x 16\'': '38 Series Lap 3/8" x 8" x 16\'',
        'LP Strand Shake 3/8" x 12" x 4\'':       'Shake',
        'LP Nickel Gap 1/2" x 8" x 16\'':         'Nickel Gap',
        "LP Strand Panel 3/8\" x 4' x 8'":        "38 Series 4' x 8' Panel",
        "LP Strand Panel 3/8\" x 4' x 10'":       "38 Series 4' x 10' Panel",
        'LP Strand Panel 3/8" x 16" x 16\'':      '38 Series Vertical Panel',
        # Trim (190 + 440 × 5 + 540 × 5)
        'LP 190 Trim 5/8" x 3" x 16\'':           '190 Series Trim 19/32" x 3" x 16\'',
        'LP 440 Trim 3/4" x 4" x 16\'':           '440 Series Trim 4/4" x 4" x 16\'',
        'LP 440 Trim 3/4" x 6" x 16\'':           '440 Series Trim 4/4" x 6" x 16\'',
        'LP 440 Trim 3/4" x 8" x 16\'':           '440 Series Trim 4/4" x 8" x 16\'',
        'LP 440 Trim 3/4" x 10" x 16\'':          '440 Series Trim 4/4" x 10" x 16\'',
        'LP 440 Trim 3/4" x 12" x 16\'':          '440 Series Trim 4/4" x 12" x 16\'',
        'LP 540 Trim 3/4" x 4" x 16\'':           '540 Series Trim 5/4" x 4" x 16\'',
        'LP 540 Trim 3/4" x 6" x 16\'':           '540 Series Trim 5/4" x 6" x 16\'',
        'LP 540 Trim 3/4" x 8" x 16\'':           '540 Series Trim 5/4" x 8" x 16\'',
        'LP 540 Trim 3/4" x 10" x 16\'':          '540 Series Trim 5/4" x 10" x 16\'',
        'LP 540 Trim 3/4" x 12" x 16\'':          '540 Series Trim 5/4" x 12" x 16\'',
        # Accessories
        'LP Outside corners 4" x 16\'':           '540 Series OSC 5/4" x 4" x 16\'',
        'LP Outside corners 6" x 16\'':           '540 Series OSC 5/4" x 6" x 16\'',
        'LP Touch-up Kit':                        'Touch up kits',
        'LP Caulking Color Match':                'OSI Quad Max Caulking',
        'LP J-blocks 1" W/FLASHING':              'J blocks',
        'LP Mini Split 1" W/FLASHING':            'Mini Splits',
        # Soffit (16" Vented kept; 24" Vented→VSSFT, 24" Solid→CTW)
        'LP Soffit 3/8" x 16" x 16\' Vented':     '38 Series Soffit 16 x 16 Vented',
        'LP Soffit 3/8" x 24" x 16\' Vented':     '24 inch VSSFT',
        'LP Soffit 3/8" x 24" x 16\' Solid':      '24 inch CTW soffit',
    }
    LP_DROP_NAMES = ['LP Color Match Coil']
    LP_TRIM_NEW_NAMES = {
        '190 Series Trim 19/32" x 3" x 16\'',
        '440 Series Trim 4/4" x 4" x 16\'',
        '440 Series Trim 4/4" x 6" x 16\'',
        '440 Series Trim 4/4" x 8" x 16\'',
        '440 Series Trim 4/4" x 10" x 16\'',
        '440 Series Trim 4/4" x 12" x 16\'',
        '540 Series Trim 5/4" x 4" x 16\'',
        '540 Series Trim 5/4" x 6" x 16\'',
        '540 Series Trim 5/4" x 8" x 16\'',
        '540 Series Trim 5/4" x 10" x 16\'',
        '540 Series Trim 5/4" x 12" x 16\'',
    }
    LP_LAP_NEW_NAME = '38 Series Lap 3/8" x 8" x 16\''
    # Estimate-line migration: rename + unit/qty flips. Bounded to LP
    # estimates only via line-name match — safe to run on every boot.
    async for est in db.estimates.find(
        {"lines.name": {"$in": list(LP_RENAME_MAP.keys()) + LP_DROP_NAMES}},
        {"lines": 1},
    ):
        lines = est.get("lines", [])
        changed = False
        new_lines = []
        for ln in lines:
            name = ln.get("name")
            if name in LP_DROP_NAMES:
                # Drop "LP Color Match Coil" entirely from saved estimates.
                changed = True
                continue
            if name in LP_RENAME_MAP:
                ln["name"] = LP_RENAME_MAP[name]
                changed = True
            # Trim LF → PCS: ceil(qty / 16), unit "LF" → "PCS", mat × 16
            # (old LF mat × 16 = per-16'-board mat → preserves line total).
            if ln.get("name") in LP_TRIM_NEW_NAMES and ln.get("unit") == "LF":
                ln["qty"] = max(1, math.ceil(float(ln.get("qty") or 0) / 16.0))
                ln["unit"] = "PCS"
                old_mat = float(ln.get("mat") or 0)
                if old_mat > 0:
                    ln["mat"] = round(old_mat * 16, 2)
                changed = True
            # Lap SQ → PCS: qty × 11, unit "SQ" → "PCS", mat ÷ 11
            # (old SQ mat ÷ 11 = per-board mat → preserves line total).
            if ln.get("name") == LP_LAP_NEW_NAME and ln.get("unit") == "SQ":
                ln["qty"] = max(1, round(float(ln.get("qty") or 0) * 11))
                ln["unit"] = "PCS"
                old_mat = float(ln.get("mat") or 0)
                if old_mat > 0:
                    ln["mat"] = round(old_mat / 11.0, 2)
                changed = True
            new_lines.append(ln)
        if changed:
            await db.estimates.update_one(
                {"_id": est["_id"]}, {"$set": {"lines": new_lines}}
            )
    # In-flight cleanup: an earlier hot-reload migrated qty + unit but
    # forgot to rescale `mat`, leaving Lap lines at "229 PCS × $298.24/SQ"
    # and Trim lines at "5 PCS × $1.08/LF". Heuristic catch:
    #   - Lap PCS row with mat > $100 → clearly still the old SQ value → ÷ 11.
    #   - Trim PCS row with mat < $5  → clearly still the old LF value → × 16.
    # Bounded to the renamed LP item names so it can't disturb anything else.
    async for est in db.estimates.find(
        {"lines.name": {"$in": [LP_LAP_NEW_NAME] + list(LP_TRIM_NEW_NAMES)}},
        {"lines": 1},
    ):
        lines = est.get("lines", [])
        fixed = False
        for ln in lines:
            nm = ln.get("name")
            mat = float(ln.get("mat") or 0)
            if (nm == LP_LAP_NEW_NAME and ln.get("unit") == "PCS"
                    and mat > 100):
                ln["mat"] = round(mat / 11.0, 2)
                fixed = True
            if (nm in LP_TRIM_NEW_NAMES and ln.get("unit") == "PCS"
                    and 0 < mat < 5):
                ln["mat"] = round(mat * 16, 2)
                fixed = True
        if fixed:
            await db.estimates.update_one(
                {"_id": est["_id"]}, {"$set": {"lines": lines}}
            )
    # Iter 78k (2026-02-25): Howard reversed the Iter 69 vinyl/ascend labor
    # lockdown. Labor is now editable on ALL siding tabs (vinyl, ascend,
    # lp_smart). The boot-time `$set lab: 0` was kept around briefly to
    # match the frontend lockdown but is now removed — contractors can
    # type labor on any siding line and it persists across restarts.
    # Historical $0 values on the existing estimates stay $0 until the
    # contractor edits them (no auto-restore of a "default labor" since
    # the catalog never carried one for siding profiles).
    # Iter 70 (2026-06-22): "Cap windows with wide crown" moved from
    # IDENTICAL_PRICES ($65) → ZERO_PRICED. Force mat=$0 on every tier
    # doc and on any saved estimate line still carrying the old $65.
    # Idempotent — finds nothing after first run.
    await db.price_tiers.update_many(
        {"sections.items": {"$elemMatch": {
            "name": "Cap windows with wide crown",
            "mat": {"$ne": 0},
        }}},
        {"$set": {"sections.$[].items.$[it].mat": 0.0}},
        array_filters=[{"it.name": "Cap windows with wide crown"}],
    )
    await db.estimates.update_many(
        {"lines": {"$elemMatch": {
            "name": "Cap windows with wide crown",
            "mat": {"$ne": 0},
        }}},
        {"$set": {"lines.$[ln].mat": 0}},
        array_filters=[{
            "ln.name": "Cap windows with wide crown",
            "ln.mat": {"$ne": 0},
        }],
    )
    # Tier-doc migration: rename, unit-flip, drop the dropped names.
    for old_name, new_name in LP_RENAME_MAP.items():
        await db.price_tiers.update_many(
            {"sections.items.name": old_name},
            {"$set": {"sections.$[].items.$[it].name": new_name}},
            array_filters=[{"it.name": old_name}],
        )
    # Pull dropped LP item rows out of every section.
    await db.price_tiers.update_many(
        {"sections.items.name": {"$in": LP_DROP_NAMES}},
        {"$pull": {"sections.$[].items": {"name": {"$in": LP_DROP_NAMES}}}},
    )
    # Flip trim unit LF → PCS in tier docs (qty doesn't live on tier docs;
    # only estimate lines carry qty — already migrated above).
    for trim_name in LP_TRIM_NEW_NAMES:
        await db.price_tiers.update_many(
            {"sections.items": {"$elemMatch": {"name": trim_name, "unit": "LF"}}},
            {"$set": {"sections.$[].items.$[it].unit": "PCS"}},
            array_filters=[{"it.name": trim_name, "it.unit": "LF"}],
        )
    # Flip Lap unit SQ → PCS on tier docs.
    await db.price_tiers.update_many(
        {"sections.items": {"$elemMatch": {"name": LP_LAP_NEW_NAME, "unit": "SQ"}}},
        {"$set": {"sections.$[].items.$[it].unit": "PCS"}},
        array_filters=[{"it.name": LP_LAP_NEW_NAME, "it.unit": "SQ"}],
    )
    # Force-sync mat for every LP item per the new supplier cost + margin
    # tier pricing in TIER_PRICES. Bounded to LP item names so it can't
    # touch any non-LP supplier override. Idempotent.
    LP_ITEM_NAMES = set(LP_RENAME_MAP.values()) | LP_TRIM_NEW_NAMES | {
        LP_LAP_NEW_NAME,
        '38 Series Lap 3/8" x 6" x 16\'',
        '38 Series Soffit 12 x 16 Vented',
        '38 Series Soffit 12 x 16 Closed',
        '38 Series Soffit 16 x 16 Closed',
        '.019 Coil', 'PVC Trim Coil', 'Performance G8 Trim Coil',
    }
    async for tier in db.price_tiers.find({}, {"_id": 0, "id": 1, "name": 1, "sections": 1}):
        prices = TIER_PRICES.get(tier["name"]) or {}
        sections = tier.get("sections") or []
        dirty = False
        for sec in sections:
            for it in sec.get("items", []) or []:
                if it.get("name") in LP_ITEM_NAMES:
                    want = float(prices.get(it["name"], 0))
                    if want > 0 and float(it.get("mat") or 0) != want:
                        it["mat"] = want
                        dirty = True
        if dirty:
            await db.price_tiers.update_one(
                {"id": tier["id"]},
                {"$set": {"sections": sections,
                          "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            logger.info("Iter 67: synced LP prices on tier %s", tier["name"])
    # Iter 29: the Windows tab sections were appended to existing tier docs
    # at $0 mat/lab on first boot (before TIER_PRICES + ITEM_META had real
    # values). Force-reconcile mat (from TIER_PRICES) and lab (from
    # ITEM_META) on every Windows-tab item so the prices Howard provided
    # appear in the catalog. Idempotent: only writes when the DB value
    # disagrees with code, so it won't clobber contractor overrides made
    # later via the pricing admin (which writes elsewhere).
    WINDOWS_SECTIONS_FOR_PRICE_SYNC = {
        "Vero Windows", "Window Upgrade Options", "Window Installation",
        "Vero Sliding Glass Doors", "Sliding Glass Door Install",
        "Window Exterior Trim Work", "Window Interior Trim Work",
        "Window Misc.",
    }
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
                # Iter 34: same race can leave lab at $0 on items that should
                # default to a non-zero lab (e.g. all the siding profiles at
                # $125/SQ). Bounded to BACKFILL so it can't disturb deliberate
                # supplier overrides on other items.
                if it.get("name") in BACKFILL and float(it.get("lab") or 0) == 0:
                    meta = ITEM_META.get(it["name"])
                    if meta and float(meta[1]) > 0:
                        it["lab"] = float(meta[1])
                        changed = True
                # Windows-tab price sync (Iter 29): see WINDOWS_SECTIONS_FOR_
                # PRICE_SYNC comment above. Forces mat from TIER_PRICES + lab
                # from ITEM_META on any Windows item whose DB value disagrees
                # with code. Idempotent and bounded to Windows sections.
                if sec.get("title") in WINDOWS_SECTIONS_FOR_PRICE_SYNC:
                    want_mat = prices.get(it.get("name"))
                    if (want_mat is not None
                            and float(it.get("mat") or 0) != float(want_mat)):
                        it["mat"] = float(want_mat)
                        changed = True
                    meta = ITEM_META.get(it.get("name"))
                    if meta is not None and float(it.get("lab") or 0) != float(meta[1]):
                        it["lab"] = float(meta[1])
                        changed = True
        if changed:
            await db.price_tiers.update_one(
                {"id": tier["id"]},
                {"$set": {"sections": sections,
                          "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            logger.info("Backfilled Ascend prices on tier %s", tier["name"])
    # Iter 78e (2026-02): backfill mat prices for the 4 new accessory items
    # (Flash tape, Gutter Sealant, Hangars with Screws, Pipe Clips). When
    # SECTION_LAYOUT was extended, the migration loop below rebuilt the
    # affected sections, but during the transient window before TIER_PRICES
    # had the new entries some tier docs ended up with mat=$0. Force-sync
    # those rows in place. Bounded to these item names so it can't touch
    # any other contractor override. Idempotent.
    ITER78E_NEW_ITEMS = {
        'Flash tape 3 3/4" x 90\'',
        'Gutter Sealant',
        'Hangars with Screws',
        'Pipe Clips',
    }
    async for tier in db.price_tiers.find({}, {"_id": 0, "id": 1, "name": 1, "sections": 1}):
        prices = TIER_PRICES.get(tier["name"]) or {}
        sections = tier.get("sections") or []
        dirty = False
        for sec in sections:
            for it in sec.get("items", []) or []:
                if it.get("name") in ITER78E_NEW_ITEMS:
                    want = float(prices.get(it["name"], 0))
                    if want > 0 and float(it.get("mat") or 0) != want:
                        it["mat"] = want
                        dirty = True
        if dirty:
            await db.price_tiers.update_one(
                {"id": tier["id"]},
                {"$set": {"sections": sections,
                          "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            logger.info("Iter 78e: synced new accessory prices on tier %s", tier["name"])

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
        existing_titles = {s.get("title") for s in sections}
        dirty = False
        for i, sec in enumerate(sections):
            # Reconcile product_lines on every section every boot so any code
            # change to SECTION_PRODUCT_LINES propagates without manual DB
            # work. Iter 23 cleanup: the "Ascend Cladding" section was first
            # created with the default ["vinyl","ascend"] during a hot-reload
            # race before SECTION_PRODUCT_LINES had its entry — this fixes
            # those stale rows in place.
            want_pls = product_lines_for(sec["title"])
            if sec.get("product_lines") != want_pls:
                sec["product_lines"] = want_pls
                dirty = True
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
                # Same item set — backfill ami_part AND reconcile unit from
                # ITEM_META so unit fixes (e.g. SQ→PCS typo corrections) flow
                # to existing DB tier docs without manual migration.
                for item in sec.get("items", []):
                    want_ami = ITEM_AMI.get(item.get("name"))
                    if want_ami and item.get("ami_part") != want_ami:
                        item["ami_part"] = want_ami
                        dirty = True
                    meta = ITEM_META.get(item.get("name"))
                    if meta and meta[0] and item.get("unit") != meta[0]:
                        item["unit"] = meta[0]
                        dirty = True
                # Iter 36: reconcile the `adders` field on window sections
                # so per-window-type upgrade options propagate to existing
                # tier docs without a manual rebuild. Idempotent: only
                # writes when the DB value disagrees with the catalog.
                want_adders = fresh_sec.get("adders")
                if want_adders is not None and sec.get("adders") != want_adders:
                    sec["adders"] = want_adders
                    dirty = True
        # Append any sections introduced by a newer SECTION_LAYOUT that don't
        # yet exist in this tier doc (e.g. the LP SmartSide sections added
        # in Iter 22 — without this step the rebuild loop above would skip
        # them entirely because it only iterates over existing sections).
        for fresh_sec in fresh:
            if fresh_sec["title"] not in existing_titles:
                logger.info(
                    "Adding new section %s to tier %s",
                    fresh_sec["title"], tier["name"],
                )
                sections.append(fresh_sec)
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
def _brand_window_mat(est: dict, brand: str, openings: list, opening_mat_fn) -> float:
    """Iter 57v — Compute the brand's window-material subtotal honouring
    the Window Package Quote override. When `{brand}_package_quote` is
    enabled with a positive total, return that flat number (overriding
    the per-opening bucket sum). Otherwise fall back to summing each
    opening through `opening_mat_fn`."""
    pq = est.get(f"{brand}_package_quote") or {}
    if pq.get("enabled") and float(pq.get("total") or 0) > 0:
        return float(pq["total"])
    return sum(opening_mat_fn(op) for op in openings)


def calc_totals(est: dict) -> dict:
    lines = est.get("lines", []) or []
    misc_labor = est.get("misc_labor", []) or []
    misc_material = est.get("misc_material", []) or []
    # Iter 37: Mezzo openings are stored separately because their price
    # is W×H-derived (bucket-lookup at save time). Subtotal contribution
    # = opening.qty × base_mat + sum(adder.qty × adder.mat). Lives in
    # the material side of the ledger — Mezzo labor is on the regular
    # Window Installation row tracked under est.lines.
    mezzo_openings = est.get("mezzo_openings", []) or []
    # Iter 39: Vero W×H openings (Phase 4). Per-window price =
    #   base_mat (sister-color column inside bucket)
    # + glass_mat (selected glass package, bucketed adder)
    # + tempered_mat (optional tempered upcharge)
    # + premium_mat (sum of selected premium options on DH/Picture)
    # Total contribution = qty × (base + glass + tempered + premium).
    vero_openings = est.get("vero_openings", []) or []
    # Iter 36: each adder carries its OWN qty (independent of line.qty)
    # so a line can have e.g. 10 windows with only 3 Tempered glass. The
    # adder's mat/lab is multiplied by the adder qty and added to the
    # line's subtotal alongside the base line.qty * (line.mat + line.lab).
    def _adders_mat_total(ln: dict) -> float:
        return sum((float(a.get("qty") or 0)) * (float(a.get("mat") or 0))
                   for a in (ln.get("adders") or []))
    def _adders_lab_total(ln: dict) -> float:
        return sum((float(a.get("qty") or 0)) * (float(a.get("lab") or 0))
                   for a in (ln.get("adders") or []))
    def _opening_mat(op: dict) -> float:
        qty = float(op.get("qty") or 0)
        base = float(op.get("base_mat") or 0)
        adders = sum((float(a.get("qty") or 0)) * (float(a.get("mat") or 0))
                     for a in (op.get("adders") or []))
        return qty * base + adders
    def _vero_opening_mat(op: dict) -> float:
        qty = float(op.get("qty") or 0)
        per_window = (
            float(op.get("base_mat") or 0)
            + float(op.get("glass_mat") or 0)
            + float(op.get("tempered_mat") or 0)
            + float(op.get("premium_mat") or 0)
        )
        return qty * per_window
    sub_mat = (
        sum((ln.get("qty", 0) or 0) * (ln.get("mat", 0) or 0) + _adders_mat_total(ln) for ln in lines)
        + sum((m.get("mat", 0) or 0) for m in misc_material)
        + _brand_window_mat(est, "mezzo", mezzo_openings, _opening_mat)
        + _brand_window_mat(est, "vero", vero_openings, _vero_opening_mat)
    )
    sub_lab = (
        sum((ln.get("qty", 0) or 0) * (ln.get("lab", 0) or 0) + _adders_lab_total(ln) for ln in lines)
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
        # Iter 23: the 2 Ascend siding items moved into their own "Ascend
        # Cladding" section. Accept BOTH the new section name and the legacy
        # "Ascend Cladding/Accessories" name so old estimates that haven't
        # been re-saved (and thus haven't picked up the migration) still
        # apply waste correctly.
        return (
            ln.get("section") in {"Ascend Cladding", "Ascend Cladding/Accessories"}
            and ln.get("name") in WASTE_ASCEND
        )
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
