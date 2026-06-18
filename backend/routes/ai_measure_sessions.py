"""AI Measure session persistence.

Keeps a contractor's in-progress AI Measure work alive across page
refreshes / tab closes. One session per estimate (1:1 by estimate_id).

What we persist:
- The uploaded photo URLs (the files themselves already live on disk in
  UPLOAD_DIR via the existing /api/uploads pipeline).
- The AI preview (Claude's `measurements`, `raw_ai`, `lines`, etc.).
- The contractor's wall-table overrides — these mutate the preview
  in-place on the frontend so they ride along with the preview save.
- The form-level overrides (reference dimension, wall height, siding %,
  overhang).

What we deliberately DON'T persist (yet):
- The Refine-on-Photo tap measurements / openings / zones. Those use
  pixel coords keyed to the in-browser blob URLs and would need
  remapping to the server URLs on restore. Future enhancement.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db
from deps import get_current_user

router = APIRouter(prefix="/measure", tags=["measure"])


class AIMeasureSessionIn(BaseModel):
    estimate_id: str
    photo_urls: List[str] = []
    reference_dim: Optional[str] = ""
    wall_height: Optional[str] = ""
    siding_pct: Optional[str] = ""
    overhang_in: Optional[float] = 12.0
    preview: Optional[Dict[str, Any]] = None  # {measurements, raw_ai, lines, vero_openings}
    # Iter 56: pre-AI per-photo annotations (elevation tag, scale anchor,
    # zone masks, target-house pin). Keyed by upload filename. Lost on
    # navigation/refresh prior to this addition — fixed in Iter 56f.
    photo_annotations: Optional[Dict[str, Any]] = None


@router.get("/sessions/{estimate_id}")
async def get_session(estimate_id: str, user: dict = Depends(get_current_user)):
    company_id = user.get("company_id")
    doc = await db.ai_measure_sessions.find_one(
        {"estimate_id": estimate_id, "company_id": company_id}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No session")
    doc.pop("_id", None)
    return doc


@router.put("/sessions/{estimate_id}")
async def upsert_session(
    estimate_id: str,
    body: AIMeasureSessionIn,
    user: dict = Depends(get_current_user),
):
    company_id = user.get("company_id")
    payload = body.model_dump()
    payload["estimate_id"] = estimate_id  # path wins over body
    payload["company_id"] = company_id
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.ai_measure_sessions.update_one(
        {"estimate_id": estimate_id, "company_id": company_id},
        {"$set": payload},
        upsert=True,
    )
    return {"ok": True, "updated_at": payload["updated_at"]}


@router.delete("/sessions/{estimate_id}")
async def delete_session(estimate_id: str, user: dict = Depends(get_current_user)):
    company_id = user.get("company_id")
    await db.ai_measure_sessions.delete_one(
        {"estimate_id": estimate_id, "company_id": company_id}
    )
    return {"ok": True}
