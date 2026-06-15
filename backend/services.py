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
            "Window - Block Frame Replacement",
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
        # Vinyl Soffit with Siding
        'Soffit & fascia up to 13" wide Charter Oak Standard color',
        'Soffit & fascia up to 13" wide Charter Oak Architectural color',
        'Soffit & fascia up to 13"-30" wide Charter Oak Standard color',
        'Soffit & fascia up to 13"-30" wide Charter Oak Architectural color',
        '3/4" Soffit J-Channel (Charter Oak) Standard color',
        '3/4" Soffit J-Channel (Charter Oak) Architectural color',
    ]
    # Iter 28: LP trim moved from per-piece to per-LF pricing (Howard's
    # request — 16' boards, so LF price = PCS price ÷ 16). Force-update mat
    # on these 11 items across all 4 tiers so the new LF prices show up
    # without a manual reseed. Idempotent: only updates rows whose current
    # mat doesn't match the new LF price in TIER_PRICES.
    LP_TRIM_RELIST = [
        'LP 190 Trim 5/8" x 3" x 16\'',
        'LP 440 Trim 3/4" x 4" x 16\'',
        'LP 440 Trim 3/4" x 6" x 16\'',
        'LP 440 Trim 3/4" x 8" x 16\'',
        'LP 440 Trim 3/4" x 10" x 16\'',
        'LP 440 Trim 3/4" x 12" x 16\'',
        'LP 540 Trim 3/4" x 4" x 16\'',
        'LP 540 Trim 3/4" x 6" x 16\'',
        'LP 540 Trim 3/4" x 8" x 16\'',
        'LP 540 Trim 3/4" x 10" x 16\'',
        'LP 540 Trim 3/4" x 12" x 16\'',
    ]
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
                # LP trim PCS→LF conversion (Iter 28): force the new LF price
                # AND the new "LF" unit. Doesn't touch any other item, so it
                # won't clobber contractor-side overrides made via the bulk
                # pricing admin.
                if it.get("name") in LP_TRIM_RELIST:
                    want_mat = float(prices.get(it["name"], 0))
                    if want_mat > 0 and float(it.get("mat") or 0) != want_mat:
                        it["mat"] = want_mat
                        changed = True
                    if it.get("unit") != "LF":
                        it["unit"] = "LF"
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
        + sum(_opening_mat(op) for op in mezzo_openings)
        + sum(_vero_opening_mat(op) for op in vero_openings)
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
