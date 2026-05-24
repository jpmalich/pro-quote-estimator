"""Quote-email delivery via Resend + email-config status."""
import asyncio
import base64

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from config import RESEND_API_KEY, SENDER_EMAIL
from db import db, logger
from deps import get_current_user
from models import EmailQuoteIn
from pdf import render_pdf, safe_filename

router = APIRouter()


@router.post("/estimates/{est_id}/email")
async def email_quote(est_id: str, body: EmailQuoteIn, user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one(
        {"id": est_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    if not RESEND_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Email service not configured. Add RESEND_API_KEY to enable.",
        )
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        # Look up the contractor's actual company name for the subject fallback.
        company = await db.companies.find_one(
            {"id": user["company_id"]}, {"_id": 0, "name": 1}
        )
        company_name = (company or {}).get("name") or "your contractor"
        # Replies should go back to the contractor — not the shared Resend sending address.
        # Prefer the company owner so a teammate's quote still hits the right inbox.
        owner = await db.users.find_one(
            {"company_id": user["company_id"], "role": "owner"},
            {"_id": 0, "email": 1, "name": 1},
        )
        reply_to_email = (owner or {}).get("email") or user.get("email")

        # Persist the client-generated accept token (idempotent — keep the first one assigned)
        # and bump the estimate's status to "sent" so the dashboard can show pipeline state.
        update_set = {"status_label": "sent", "last_sent_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()}
        if body.accept_token and not est.get("accept_token"):
            update_set["accept_token"] = body.accept_token
            update_set["recipient_email"] = body.recipient_email
        await db.estimates.update_one({"id": est_id}, {"$set": update_set})

        # Render the same email-safe HTML to a PDF and attach. WeasyPrint can block
        # for a moment on large jobs, so push it to a thread.
        pdf_bytes = await asyncio.to_thread(render_pdf, body.html_quote)
        pdf_name = safe_filename(est.get("estimate_number"), est.get("customer_name"))

        params = {
            "from": SENDER_EMAIL,
            "to": [body.recipient_email],
            "reply_to": reply_to_email,
            "subject": body.subject or f"Your siding estimate from {company_name}",
            "html": body.html_quote,
            # Tags let Resend's webhooks correlate open/click events back to this estimate.
            "tags": [
                {"name": "estimate_id", "value": est_id},
                {"name": "company_id", "value": user["company_id"]},
            ],
            "attachments": [
                {
                    "filename": pdf_name,
                    "content": base64.b64encode(pdf_bytes).decode("ascii"),
                    "content_type": "application/pdf",
                }
            ],
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        return {
            "status": "sent",
            "id": result.get("id"),
            "attachment": {"filename": pdf_name, "size_bytes": len(pdf_bytes)},
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("email failed")
        raise HTTPException(status_code=500, detail=f"Email failed: {e}")


@router.post("/estimates/{est_id}/pdf")
async def download_pdf(est_id: str, body: EmailQuoteIn, user: dict = Depends(get_current_user)):
    """Render the email-safe HTML directly to a PDF for in-app download.
    The client passes the SAME html that would be emailed, so the contractor
    sees the exact document the customer will receive."""
    est = await db.estimates.find_one(
        {"id": est_id, "company_id": user["company_id"]}, {"_id": 0}
    )
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    try:
        pdf_bytes = await asyncio.to_thread(render_pdf, body.html_quote)
    except Exception as e:
        logger.exception("pdf render failed")
        raise HTTPException(status_code=500, detail=f"PDF render failed: {e}")
    fname = safe_filename(est.get("estimate_number"), est.get("customer_name"))
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/email/status")
async def email_status(user: dict = Depends(get_current_user)):
    return {"configured": bool(RESEND_API_KEY), "sender": SENDER_EMAIL if RESEND_API_KEY else None}
