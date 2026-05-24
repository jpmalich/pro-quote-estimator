"""Estimate CRUD + CSV exports."""
import csv
import io
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
async def list_estimates(user: dict = Depends(get_current_user)):
    cursor = db.estimates.find({"company_id": user["company_id"]}, {"_id": 0}).sort("updated_at", -1)
    return await cursor.to_list(500)


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
        "estimate_number": f"EST-{int(__import__('time').time()) % 1_000_000:06d}",
        "estimate_date": now[:10],
        "status_label": "draft",
        "notes": (src.get("notes") or ""),  # carry scope forward; contractor can edit
    })
    await db.estimates.insert_one(src)
    src.pop("_id", None)
    return src


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
