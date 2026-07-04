"""Estimate CRUD + CSV exports."""
import csv
import io
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from db import db
from deps import get_current_user
from models import EstimateIn
from services import calc_totals, get_branding
from routes.catalog import _resolve_catalog_for_company
from routes.hover import _build_lines

router = APIRouter()


# ---------------------------------------------------------------------------
# CRUD — note CSV exports are registered BEFORE /estimates/{est_id}
# so the literal path wins when FastAPI matches.
# ---------------------------------------------------------------------------
@router.get("/estimates")
async def list_estimates(
    kind: str = "", user: dict = Depends(get_current_user)
):
    """List estimates for this company. Optional `?kind=siding|windows`
    filter scopes the result to one workspace's estimates. Estimates
    without an explicit kind field default to "siding" for back-compat
    with quotes created before the windows workspace existed."""
    q = {"company_id": user["company_id"]}
    if kind == "windows":
        q["kind"] = "windows"
    elif kind == "iss":
        q["kind"] = "iss"
    elif kind == "lp_smart":
        # Iter 73: LP got its own workspace. Match only explicit lp_smart
        # kind — no fallback to legacy/no-kind estimates (those belong on
        # the Siding workspace).
        q["kind"] = "lp_smart"
    elif kind == "siding":
        # Include both explicit "siding" AND legacy estimates with no kind.
        q["$or"] = [{"kind": "siding"}, {"kind": {"$exists": False}}, {"kind": ""}]
    cursor = db.estimates.find(q, {"_id": 0}).sort("updated_at", -1)
    estimates = await cursor.to_list(500)
    # Iter 41: surface the paired estimate's number on each row so the
    # dashboard can render a one-click chain-link badge → paired estimate.
    paired_ids = [e["paired_estimate_id"] for e in estimates if e.get("paired_estimate_id")]
    if paired_ids:
        paired_docs = await db.estimates.find(
            {"id": {"$in": paired_ids}, "company_id": user["company_id"]},
            {"_id": 0, "id": 1, "estimate_number": 1, "kind": 1},
        ).to_list(500)
        by_id = {p["id"]: p for p in paired_docs}
        for e in estimates:
            pid = e.get("paired_estimate_id")
            if pid and pid in by_id:
                e["paired_estimate_number"] = by_id[pid].get("estimate_number") or ""
                e["paired_estimate_kind"] = by_id[pid].get("kind") or ""
    return estimates


@router.post("/estimates")
async def create_estimate(body: EstimateIn, user: dict = Depends(get_current_user)):
    est_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = body.model_dump()
    # Fall back to the supplier's configured default when the client didn't pick one.
    if not doc.get("pricing_mode"):
        b = await get_branding()
        doc["pricing_mode"] = b.get("default_pricing_mode") or "margin"
    # Auto-populate what we already know (fill-if-empty only — the client's
    # values always win, and the contractor can edit everything afterward):
    # the estimator is whoever is creating the estimate; the job State
    # defaults to the company's last-used state (most jobs are local).
    if not doc.get("estimator"):
        doc["estimator"] = user.get("name") or ""
    if not doc.get("estimate_date"):
        doc["estimate_date"] = now[:10]
    if not doc.get("address_state"):
        prev = await db.estimates.find_one(
            {"company_id": user["company_id"], "address_state": {"$nin": [None, ""]}},
            {"address_state": 1},
            sort=[("updated_at", -1)],
        )
        if prev:
            doc["address_state"] = prev["address_state"]
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


@router.post("/estimates/{est_id}/duplicate")
async def duplicate_estimate(est_id: str, user: dict = Depends(get_current_user)):
    """Clone an existing estimate. Keeps line items, labor overrides, settings,
    and pricing mode — but clears customer-specific fields and assigns a fresh
    estimate number so the contractor can't accidentally email duplicates."""
    src = await db.estimates.find_one(
        {"id": est_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not src:
        raise HTTPException(status_code=404, detail="Not found")

    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    # Strip everything that's customer-specific or post-send state.
    for key in (
        "id", "_id",
        "customer_name", "address",
        "accept_token", "accepted_at", "accepted_ip", "accepted_note",
        "last_sent_at", "recipient_email",
    ):
        src.pop(key, None)

    src.update({
        "id": new_id,
        "company_id": user["company_id"],
        "created_by": user["id"],
        "created_by_name": user.get("name"),
        "created_at": now,
        "updated_at": now,
        "estimate_number": f"EST-{int(time.time()) % 1_000_000:06d}",
        "estimate_date": now[:10],
        "status_label": "draft",
        "notes": (src.get("notes") or ""),  # carry scope forward; contractor can edit
    })
    await db.estimates.insert_one(src)
    src.pop("_id", None)
    return src


@router.post("/estimates/{est_id}/pair")
async def pair_estimate(est_id: str, user: dict = Depends(get_current_user)):
    """Spawn (or return existing) paired estimate of the opposite kind.

    Iter 41: when a contractor uploads HOVER on a siding estimate that
    contains window measurements, the importer calls this to auto-create
    a paired windows-kind estimate so the window scope doesn't get
    stranded. Mirrored for windows → siding too.

    Behavior:
      - Idempotent: if the source already has a `paired_estimate_id`
        pointing to a real doc, return that doc unchanged.
      - EST# scheme: siding source `EST-788260` → paired `EST-788260-W`;
        windows source `EST-788260-W` → strip suffix to `EST-788260`;
        windows source `EST-788260` (no suffix) → paired `EST-788260-S`.
      - Copies on creation only: customer_name, address, estimator,
        estimate_date. Lines/openings start empty — the HOVER apply
        flow on the FE writes the correct slice to each side.
    """
    src = await db.estimates.find_one(
        {"id": est_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not src:
        raise HTTPException(status_code=404, detail="Source estimate not found")

    # Idempotent: re-use existing paired doc if still alive.
    existing_id = src.get("paired_estimate_id")
    if existing_id:
        existing = await db.estimates.find_one(
            {"id": existing_id, "company_id": user["company_id"]}, {"_id": 0}
        )
        if existing:
            return existing
        # Pointer was stale (paired estimate was deleted) — fall through
        # to re-create.

    src_kind = src.get("kind") or "siding"
    new_kind = "windows" if src_kind == "siding" else "siding"
    src_num = src.get("estimate_number") or ""
    if new_kind == "windows":
        new_num = f"{src_num}-W" if src_num else ""
    else:
        # Windows → siding. If src ends with -W, strip it; else append -S.
        new_num = src_num[:-2] if src_num.endswith("-W") else (f"{src_num}-S" if src_num else "")

    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    new_doc = {
        "id": new_id,
        "company_id": user["company_id"],
        "created_by": user["id"],
        "created_by_name": user.get("name"),
        "created_at": now,
        "updated_at": now,
        "estimate_number": new_num,
        "estimate_date": src.get("estimate_date") or now[:10],
        # One-time copy of job info (Customer, Address, Estimator).
        "customer_name": src.get("customer_name") or "",
        "address": src.get("address") or "",
        "estimator": src.get("estimator") or "",
        "kind": new_kind,
        "status_label": "draft",
        "lines": [],
        "misc_labor": [],
        "misc_material": [],
        "mezzo_openings": [],
        "vero_openings": [],
        "photos": [],
        "paired_estimate_id": est_id,
    }
    await db.estimates.insert_one(new_doc)
    # Stamp the source with a back-pointer.
    await db.estimates.update_one(
        {"id": est_id, "company_id": user["company_id"]},
        {"$set": {"paired_estimate_id": new_id, "updated_at": now}},
    )
    new_doc.pop("_id", None)
    return new_doc


@router.post("/estimates/{est_id}/pair-lp")
async def pair_lp_estimate(est_id: str, user: dict = Depends(get_current_user)):
    """Spawn (or return existing) paired LP-kind estimate.

    Iter 74: LP got its own workspace (Iter 73). When a contractor quotes
    siding + LP on the same house, this endpoint creates a fresh lp_smart-
    kind estimate carrying over customer / address / estimator / HOVER
    measurements so they don't have to retype.

    Behavior:
      - Idempotent: if the source already has a `paired_lp_estimate_id`
        pointing to a live doc, return it unchanged.
      - EST# scheme: source `EST-788260` → paired `EST-788260-L`.
        Source `EST-788260-W` (windows) → strip `-W`, append `-L` →
        `EST-788260-L`.
      - Independent of `paired_estimate_id` (siding↔windows pair) so a
        single source can fan out to BOTH windows AND lp_smart pairs.
      - Carries `hover_measurements` forward (Iter 71) so the LP HOVER
        auto-fill formulas can run on the new estimate without re-uploading
        the PDF.
    """
    src = await db.estimates.find_one(
        {"id": est_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not src:
        raise HTTPException(status_code=404, detail="Source estimate not found")
    if src.get("kind") == "lp_smart":
        # Can't pair LP from an LP estimate — pair the other way.
        raise HTTPException(
            status_code=400,
            detail="This is already an LP estimate. Pair from the siding or windows side.",
        )

    existing_id = src.get("paired_lp_estimate_id")
    if existing_id:
        existing = await db.estimates.find_one(
            {"id": existing_id, "company_id": user["company_id"]}, {"_id": 0}
        )
        if existing:
            return existing
        # Pointer stale (LP estimate deleted) — fall through to re-create.

    src_num = src.get("estimate_number") or ""
    base_num = src_num[:-2] if src_num.endswith(("-W", "-S")) else src_num
    new_num = f"{base_num}-L" if base_num else ""

    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    # Iter 75 (2026-06-22): if the source has HOVER measurements, seed the
    # LP-tab auto-fill lines server-side so the new estimate opens
    # populated (38 Series Lap, End Caps, J blocks, Mini Splits, etc.)
    # rather than empty. Uses _build_lines from the HOVER importer + the
    # company's tier catalog for mat/lab — same merge path the frontend
    # HOVER apply takes after a real import.
    seeded_lines: list[dict] = []
    measurements = src.get("hover_measurements") or None
    if measurements:
        company = await db.companies.find_one(
            {"id": user["company_id"]}, {"_id": 0}
        )
        catalog = await _resolve_catalog_for_company(company) if company else None
        price_idx = {}
        if catalog:
            for sec in catalog.get("sections", []):
                for it in sec.get("items", []):
                    price_idx[(sec["title"], it["name"])] = {
                        "mat": float(it.get("mat") or 0),
                        "lab": float(it.get("lab") or 0),
                        "unit": it.get("unit") or "",
                        "ami_part": it.get("ami_part"),
                    }
        # _build_lines emits lines for ALL tabs — we only want lp_smart on
        # the LP-pair workspace. Map each spec to an EstimateLine doc.
        for ln in _build_lines(dict(measurements)):
            if ln.get("tab") != "lp_smart":
                continue
            qty = float(ln.get("qty") or 0)
            if qty <= 0:
                continue
            cat_row = price_idx.get((ln.get("section"), ln.get("name")), {})
            seeded_lines.append({
                "section": ln.get("section", ""),
                "name": ln.get("name", ""),
                "unit": ln.get("unit") or cat_row.get("unit", ""),
                "qty": qty,
                "mat": cat_row.get("mat", 0),
                "lab": 0,  # Iter 69: siding tabs forced to $0 labor.
                "ami_part": cat_row.get("ami_part"),
                "tab": "lp_smart",
                "adders": [],
            })

    new_doc = {
        "id": new_id,
        "company_id": user["company_id"],
        "created_by": user["id"],
        "created_by_name": user.get("name"),
        "created_at": now,
        "updated_at": now,
        "estimate_number": new_num,
        "estimate_date": src.get("estimate_date") or now[:10],
        # One-time copy of job info.
        "customer_name": src.get("customer_name") or "",
        "address": src.get("address") or "",
        "estimator": src.get("estimator") or "",
        # Iter 71: carry HOVER measurements forward so LP HOVER auto-fill
        # specs (Iter 68) and per-elevation card can render on the LP side
        # without re-uploading the PDF.
        "hover_measurements": measurements,
        "kind": "lp_smart",
        "status_label": "draft",
        "lines": seeded_lines,
        "misc_labor": [],
        "misc_material": [],
        "mezzo_openings": [],
        "vero_openings": [],
        "photos": [],
        "paired_lp_estimate_id": est_id,  # back-pointer (reciprocal)
    }
    await db.estimates.insert_one(new_doc)
    await db.estimates.update_one(
        {"id": est_id, "company_id": user["company_id"]},
        {"$set": {"paired_lp_estimate_id": new_id, "updated_at": now}},
    )
    new_doc.pop("_id", None)
    return new_doc


# ---------------------------------------------------------------------------
# CSV Export — define BEFORE the /estimates/{est_id} param routes so the
# literal "/exports/..." paths match first.
# ---------------------------------------------------------------------------
@router.get("/exports/estimates.csv")
async def export_estimates_csv(user: dict = Depends(get_current_user)):
    cursor = db.estimates.find({"company_id": user["company_id"]}, {"_id": 0}).sort("updated_at", -1)
    estimates = await cursor.to_list(2000)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Estimate #", "Customer", "Address", "City", "State", "ZIP", "Email", "Phone", "Company", "Lead Source",
        "Date", "Estimator",
        "Material", "Labor", "Tax", "Base", "Pricing Mode", "Margin/Markup %", "Sell Price", "Profit",
        "Created By", "Updated At",
    ])
    for e in estimates:
        t = calc_totals(e)
        writer.writerow([
            e.get("estimate_number", ""), e.get("customer_name", ""),
            e.get("address", ""),
            e.get("address_city", "") or "", e.get("address_state", "") or "", e.get("address_zip", "") or "",
            e.get("customer_email", "") or "", e.get("customer_phone", "") or "",
            e.get("customer_company", "") or "", e.get("lead_source", "") or "",
            e.get("estimate_date", ""), e.get("estimator", ""),
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


@router.get("/exports/estimates/{est_id}.csv")
async def export_estimate_csv(est_id: str, user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one({"id": est_id, "company_id": user["company_id"]}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Not found")
    t = calc_totals(est)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Field", "Value"])
    for k, v in [
        ("Estimate #", est.get("estimate_number", "")),
        ("Customer", est.get("customer_name", "")),
        ("Address", est.get("address", "")),
        ("Street", est.get("address_street", "") or ""),
        ("City", est.get("address_city", "") or ""),
        ("State", est.get("address_state", "") or ""),
        ("ZIP", est.get("address_zip", "") or ""),
        ("Email", est.get("customer_email", "") or ""),
        ("Cell Phone", est.get("customer_phone", "") or ""),
        ("Secondary Phone", est.get("customer_phone_alt", "") or ""),
        ("Fax", est.get("customer_fax", "") or ""),
        ("Preferred Contact", est.get("customer_contact_method", "") or ""),
        ("Company", est.get("customer_company", "") or ""),
        ("Contact Title", est.get("customer_contact_title", "") or ""),
        ("Billing Address", est.get("billing_address", "") or ""),
        ("Lead Source", est.get("lead_source", "") or ""),
        ("Lead Source Detail", est.get("lead_source_detail", "") or ""),
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
        # Iter 78z++++ — legacy "Misc. Labor Only" estimates still in
        # the DB. The migration in services.py moves these rows into
        # `misc_material`, so this loop only fires for un-migrated docs.
        writer.writerow(["Misc. Labor and Material", m.get("desc", ""), "—", 1, 0, m.get("lab", 0), f"{(m.get('lab', 0) or 0):.2f}"])
    for m in est.get("misc_material", []) or []:
        writer.writerow(["Misc. Labor and Material", m.get("desc", ""), "—", 1, m.get("mat", 0), m.get("lab", 0), f"{((m.get('mat', 0) or 0) + (m.get('lab', 0) or 0)):.2f}"])
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
# Param routes (registered AFTER /exports/* so literal paths win).
# ---------------------------------------------------------------------------
@router.get("/estimates/{est_id}")
async def get_estimate(est_id: str, user: dict = Depends(get_current_user)):
    doc = await db.estimates.find_one(
        {"id": est_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


@router.put("/estimates/{est_id}")
async def update_estimate(est_id: str, body: EstimateIn, user: dict = Depends(get_current_user)):
    # exclude_none so PUTs that omit pricing_mode don't clobber the stored value
    update = body.model_dump(exclude_none=True)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.estimates.update_one(
        {"id": est_id, "company_id": user["company_id"]}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.estimates.find_one({"id": est_id}, {"_id": 0})


@router.delete("/estimates/{est_id}")
async def delete_estimate(est_id: str, user: dict = Depends(get_current_user)):
    res = await db.estimates.delete_one({"id": est_id, "company_id": user["company_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}



# ---------------------------------------------------------------------------
# Iter 78z — Profile Annotations
#
# Annotations are ground-truth profile callouts (Shake / B&B / etc.) the
# contractor draws as bounding boxes on uploaded photos or blueprint
# pages BEFORE Claude analyzes them. The worker injects each annotation
# as an accent on the matching elevation, guaranteeing the catalog
# mapper emits the right per-profile line (e.g. Pelican Bay Shakes for
# the gable). Stored on the estimate so the boxes survive re-uploads
# and re-runs.
#
# Schema (free-form dict on `estimates.profile_annotations`):
#   {
#     "<photo_idx>": [
#        {"id": uuid, "x_norm": 0-1, "y_norm": 0-1, "w_norm": 0-1, "h_norm": 0-1,
#         "elevation_label": "front",
#         "profile":  "shake" | "board_batten" | ...,
#         "sqft":     number,
#         "callout":  "optional user note"},
#        ...
#     ],
#     "_scale_refs": {
#       "<photo_idx>": {"px_height": 220.0, "real_ft": 6.67}
#     }
#   }
# ---------------------------------------------------------------------------
@router.get("/estimates/{est_id}/profile-annotations")
async def get_profile_annotations(
    est_id: str, user: dict = Depends(get_current_user),
):
    doc = await db.estimates.find_one(
        {"id": est_id, "company_id": user["company_id"]},
        {"_id": 0, "profile_annotations": 1},
    )
    # Iter 79j.17 — the projection returns {} (falsy) when the estimate
    # exists but has no profile_annotations yet, so `if not doc` 404'd on
    # every fresh estimate. Only a true miss is a 404.
    if doc is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"annotations": doc.get("profile_annotations") or {}}


@router.put("/estimates/{est_id}/profile-annotations")
async def set_profile_annotations(
    est_id: str, payload: dict, user: dict = Depends(get_current_user),
):
    """Replace the entire profile_annotations blob for this estimate.
    Accept a flat dict where keys are photo_idx (str) and values are
    arrays of box dicts. The `_scale_refs` key is reserved for per-photo
    scale reference points."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")
    annotations = payload.get("annotations")
    if not isinstance(annotations, dict):
        raise HTTPException(status_code=400, detail="missing 'annotations' object")
    res = await db.estimates.update_one(
        {"id": est_id, "company_id": user["company_id"]},
        {"$set": {
            "profile_annotations": annotations,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "annotations": annotations}
