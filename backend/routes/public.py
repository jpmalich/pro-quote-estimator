"""Public (no-auth) endpoints for customer-side actions:
- GET /api/public/accept/{token}   — render the accept page data
- POST /api/public/accept/{token}  — record acceptance + notify contractor
- POST /api/public/resend-webhook  — receive Resend open/click events
"""
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from config import RESEND_API_KEY, SENDER_EMAIL
from db import db, logger
from models import CustomerAcceptIn

router = APIRouter()


def _public_estimate_summary(est: dict, company: dict | None) -> dict:
    """Strip the estimate down to what's safe to show a customer who knows the token."""
    return {
        "estimate_number": est.get("estimate_number") or "",
        "customer_name": est.get("customer_name") or "",
        "address": est.get("address") or "",
        "estimate_date": est.get("estimate_date") or "",
        "company_name": (company or {}).get("name") or "your contractor",
        "company_logo_url": (company or {}).get("logo_url"),
        "already_accepted": bool(est.get("accepted_at")),
        "accepted_at": est.get("accepted_at"),
        "accept_token": est.get("accept_token"),
    }


@router.get("/public/accept/{token}")
async def public_get_accept(token: str):
    est = await db.estimates.find_one({"accept_token": token}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found or link expired")
    company = await db.companies.find_one(
        {"id": est["company_id"]}, {"_id": 0, "name": 1, "logo_url": 1}
    )
    # Customer also needs to see the total — compute it server-side so the link is self-contained.
    from services import calc_totals
    totals = calc_totals(est)
    summary = _public_estimate_summary(est, company)
    summary["total"] = round(totals["sell"], 2)
    return summary


@router.post("/public/accept/{token}")
async def public_post_accept(token: str, body: CustomerAcceptIn, request: Request):
    est = await db.estimates.find_one({"accept_token": token}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found or link expired")
    if est.get("accepted_at"):
        # Idempotent — return the existing acceptance instead of erroring out.
        company = await db.companies.find_one(
            {"id": est["company_id"]}, {"_id": 0, "name": 1}
        )
        return {
            "ok": True,
            "already_accepted": True,
            "company_name": (company or {}).get("name") or "your contractor",
            "accepted_at": est.get("accepted_at"),
        }

    # Record acceptance
    now = datetime.now(timezone.utc).isoformat()
    client_ip = request.client.host if request.client else None
    accepted_note = (body.note or "").strip() or None
    await db.estimates.update_one(
        {"accept_token": token},
        {"$set": {
            "accepted_at": now,
            "accepted_ip": client_ip,
            "accepted_note": accepted_note,
            "status_label": "accepted",
        }},
    )

    company = await db.companies.find_one(
        {"id": est["company_id"]}, {"_id": 0, "name": 1}
    )
    company_name = (company or {}).get("name") or "your contractor"

    # Best-effort: email the company owner
    if RESEND_API_KEY:
        try:
            owner = await db.users.find_one(
                {"company_id": est["company_id"], "role": "owner"},
                {"_id": 0, "email": 1, "name": 1},
            )
            if owner and owner.get("email"):
                from services import calc_totals
                totals = calc_totals(est)
                est_num = est.get("estimate_number") or "(no number)"
                cust = est.get("customer_name") or "your customer"
                total_str = f"${totals['sell']:,.2f}"
                note_block = (
                    f"<p><b>Customer note:</b><br>{(accepted_note or '').replace(chr(10), '<br>') }</p>"
                    if accepted_note else ""
                )
                html = f"""<!doctype html>
<html><body style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#09090B;background:#F4F4F5;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #09090B;padding:32px;">
    <div style="font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#F97316;margin-bottom:8px;">Estimate Accepted</div>
    <h1 style="font-size:24px;margin:0 0 16px 0;color:#09090B;">{cust} accepted {est_num}</h1>
    <p style="font-size:16px;color:#52525B;line-height:1.6;">
      <b style="color:#09090B;">Total:</b> {total_str}<br>
      <b style="color:#09090B;">Accepted:</b> {now[:19].replace('T',' ')} UTC<br>
      <b style="color:#09090B;">IP:</b> {client_ip or 'unknown'}
    </p>
    {note_block}
    <p style="font-size:13px;color:#71717A;margin-top:24px;">Sent automatically by {company_name}'s estimating tool.</p>
  </div>
</body></html>"""
                import resend
                resend.api_key = RESEND_API_KEY
                await asyncio.to_thread(
                    resend.Emails.send,
                    {
                        "from": SENDER_EMAIL,
                        "to": [owner["email"]],
                        "subject": f"✅ Estimate {est_num} accepted by {cust}",
                        "html": html,
                    },
                )
        except Exception:
            logger.exception("acceptance notification email failed (non-fatal)")

    return {
        "ok": True,
        "already_accepted": False,
        "company_name": company_name,
        "accepted_at": now,
    }
