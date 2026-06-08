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
        "Estimate #", "Customer", "Address", "Date", "Estimator",
        "Material", "Labor", "Tax", "Base", "Pricing Mode", "Margin/Markup %", "Sell Price", "Profit",
        "Created By", "Updated At",
    ])
    for e in estimates:
        t = calc_totals(e)
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
