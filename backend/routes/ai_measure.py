"""AI Photo Measure — Claude vision-based house measurement.

Contractor uploads 2–8 photos of the property from their phone. We base64-
encode each photo and send them all in one Claude Sonnet 4.5 vision call,
asking for raw WxH per wall and opening. We aggregate Claude's reply into
the same `measurements` dict shape that `/api/estimates/hover-import`
returns, so the existing HOVER preview modal on the frontend can render
the result without changes.

Accuracy notes (surface these in the UI):
  • Without a reference object (door, brick course, tape) AI vision is
    ±10–30% off. Contractors must verify before quoting.
  • The contractor may pass `reference_dim` (e.g., "front door = 80 in"
    or "house width = 36 ft") to anchor Claude's scale.
  • Best results: 4 elevation photos (front/back/left/right) + close-ups
    of any tricky openings.

Endpoint: POST /api/measure/ai-measure  (multipart/form-data)
Form fields:
  files:           one or more JPG/PNG/WEBP photos (max 8)
  reference_dim:   optional string, e.g. "front door = 80 inches"
  address:         optional, surfaces in Claude's reply as context
  kind:            one of "siding" | "windows" | "iss"  (default: siding)
"""
from __future__ import annotations

import base64
import json
import os
import re
import uuid
from typing import Optional

from emergentintegrations.llm.chat import (
    ImageContent,
    LlmChat,
    UserMessage,
)
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from deps import get_current_user
from routes.hover import _build_lines  # reuse the same measurement→line mapper

router = APIRouter(prefix="/measure", tags=["measure"])

ACCEPTED_MIMES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
MAX_FILES = 8
MAX_BYTES_PER_FILE = 8 * 1024 * 1024  # 8 MB pre-base64
MODEL_NAME = "claude-sonnet-4-5-20250929"  # same as the HOVER PDF flow


SYSTEM_PROMPT = """\
You are a residential exterior measurement assistant for a vinyl-siding and
window contractor. The user will upload 2–8 photos of a house. Your job is
to estimate the rough exterior measurements needed for a siding + windows
quote. You MUST return JSON only — no prose, no markdown fences.

Schema:
{
  "scale_confidence": "high" | "medium" | "low",
  "reference_used": "<short description of the reference you anchored scale on, or 'none'>",
  "story_count": 1 | 1.5 | 2 | 2.5 | 3,
  "story_count_reasoning": "<1 sentence — what visual cue told you the story count>",
  "avg_wall_height_ft": number,           // average eave height used for area math
  "siding_coverage_pct": number,          // 0-100, % of gross wall area actually clad in siding (NOT brick, stone, etc.)
  "walls": [
    {"label": "front" | "back" | "left" | "right" | "other",
     "width_ft": number, "height_ft": number,
     "siding_pct_this_wall": number       // 0-100 — siding only, not brick/garage door/etc.
    }
  ],
  "openings": [
    {"type": "window" | "entry_door" | "patio_door" | "garage_door" | "vent" | "other",
     "width_in": number, "height_in": number, "wall": "front"|"back"|"left"|"right"|"other"}
  ],
  "eaves_lf": number,          // sum of horizontal soffit/gutter run, linear feet
  "rakes_lf": number,          // sum of sloped roof edges, linear feet
  "notes": "<1-2 sentences flagging anything the contractor should verify>"
}

CRITICAL accuracy rules (read every time):

1. SCALE: If the contractor provided ANY reference dimension (door width,
   wall width, garage height, brick course), anchor scale to it and set
   scale_confidence to "high". When you compute wall area, use the
   contractor-provided width VERBATIM — do not round it.

2. STORY COUNT: Look at the photos and explicitly count visible floors.
   Cues: number of window rows, height vs the garage door, attic / gable
   triangle vs eave line, etc. State the cue in story_count_reasoning.
   Default story heights when you can't see better evidence:
     1 story:    9 ft floor-to-eave
     1.5 story: 12 ft (with kneewall) — used for Cape Cod / story-and-a-half
     2 story:  18 ft
   Use these ONLY when the photos clearly show that story count. If
   uncertain, bias DOWN (one story) and reflect it in scale_confidence.

3. SIDING COVERAGE: A wall area is NOT the same as a siding area.
   Examine every wall for:
     - Brick / stone wainscot or full-wall masonry (NO siding)
     - Garage doors (NO siding behind them)
     - Stucco / EIFS panels (NO siding)
   For each wall, set siding_pct_this_wall to the visible fraction of
   the wall actually clad in siding. Compute the global
   siding_coverage_pct as a weighted average. If a house is 100% siding,
   that's fine — but DON'T assume it.

4. CONSERVATIVE BIAS: When in doubt, under-estimate. Contractors over-buy
   to cover waste; you don't need to add buffer. If your math gives a
   range, return the LOW end and flag it in notes.

5. SHOW YOUR WORK: In notes, briefly explain:
   "X walls × Y ft avg height = Z ft² gross; siding coverage A% → final
   siding area B ft²."

6. ROUNDING: Walls to nearest 0.5 ft. Openings to nearest 2 in. Final
   siding area to nearest 10 ft².

7. WHAT TO RETURN as siding_sqft (computed downstream from your walls):
   ONLY the portion of wall area that's actually siding (after applying
   siding_pct_this_wall per wall). Do not include brick/garage/etc.

Return ONLY the JSON object. No explanation, no code fences."""


def _json_from_reply(text: str) -> dict:
    """Pull the first {...} JSON object out of Claude's reply, tolerant of
    accidental code fences."""
    text = text.strip()
    # strip ```json ... ``` fences if Claude ignored the instruction
    fence = re.match(r"^```(?:json)?\s*(\{.*\})\s*```$", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    # else: try to find the first balanced { ... } block
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < 0 or end <= start:
        raise HTTPException(status_code=502, detail="AI did not return JSON")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")


def _aggregate_to_hover_shape(raw: dict) -> dict:
    """Roll up Claude's per-wall / per-opening estimates into the same
    measurements dict that the HOVER PDF importer returns. The frontend
    diff modal is reused 1-for-1.

    Each wall now carries an optional `siding_pct_this_wall` (0-100). If
    Claude saw brick / garage / stucco on part of a wall, that fraction
    is dropped from the siding area — otherwise the legacy 100% siding
    behavior holds.
    """
    walls = raw.get("walls") or []
    openings = raw.get("openings") or []

    siding_sqft = 0.0
    for w in walls:
        gross = (float(w.get("width_ft") or 0)
                 * float(w.get("height_ft") or 0))
        pct = float(w.get("siding_pct_this_wall") or 100.0)
        # Clamp to a sane range and treat null/zero defensively as 100%.
        if pct <= 0:
            pct = 100.0
        pct = min(pct, 100.0)
        siding_sqft += gross * (pct / 100.0)
    # The HOVER importer also surfaces siding_with_openings_sqft (gross
    # ft² incl. door/window openings). For AI walls we already counted
    # gross wall area, so use the same value.
    siding_with_openings_sqft = siding_sqft

    # Approximate opening areas to deduct (informational).
    opening_sqft = 0.0
    for o in openings:
        opening_sqft += (float(o.get("width_in") or 0)
                         * float(o.get("height_in") or 0)) / 144.0

    # Count openings by type (matches HOVER schema).
    counts = {"window": 0, "entry_door": 0, "patio_door": 0, "garage_door": 0}
    perimeter_lf = 0.0
    for o in openings:
        t = o.get("type", "other")
        if t in counts:
            counts[t] += 1
        # opening perimeter (used by ISS .019 Coil calc downstream)
        perimeter_lf += 2 * (
            (float(o.get("width_in") or 0) + float(o.get("height_in") or 0)) / 12.0
        )

    measurements = {
        "siding_sqft": round(siding_sqft, 1),
        "siding_with_openings_sqft": round(siding_with_openings_sqft, 1),
        "opening_sqft": round(opening_sqft, 1),
        "eaves_lf": round(float(raw.get("eaves_lf") or 0), 1),
        "rakes_lf": round(float(raw.get("rakes_lf") or 0), 1),
        "opening_perimeter_lf": round(perimeter_lf, 1),
        "opening_count": sum(counts.values()),
        "window_count": counts["window"],
        "entry_door_count": counts["entry_door"],
        "patio_door_count": counts["patio_door"],
        "garage_door_count": counts["garage_door"],
        # AI-specific surfaced fields
        "_ai_scale_confidence": raw.get("scale_confidence") or "low",
        "_ai_reference_used": raw.get("reference_used") or "none",
        "_ai_story_count": raw.get("story_count"),
        "_ai_story_count_reasoning": raw.get("story_count_reasoning") or "",
        "_ai_avg_wall_height_ft": raw.get("avg_wall_height_ft"),
        "_ai_siding_coverage_pct": raw.get("siding_coverage_pct"),
        "_ai_notes": raw.get("notes") or "",
    }
    return measurements


@router.post("/ai-measure")
async def ai_measure(
    files: list[UploadFile] = File(...),
    reference_dim: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    kind: str = Form("siding"),
    user: dict = Depends(get_current_user),
):
    """Run an AI photo-measure pass on 2-8 uploaded photos."""
    if not files:
        raise HTTPException(status_code=400, detail="At least one photo is required")
    if len(files) > MAX_FILES:
        raise HTTPException(
            status_code=400, detail=f"Maximum {MAX_FILES} photos per request",
        )

    image_contents = []
    for f in files:
        ctype = (f.content_type or "").lower()
        if ctype not in ACCEPTED_MIMES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type {ctype!r} — use JPG, PNG, or WEBP",
            )
        raw = await f.read()
        if len(raw) > MAX_BYTES_PER_FILE:
            raise HTTPException(
                status_code=413,
                detail=f"{f.filename}: file exceeds 8 MB limit",
            )
        if len(raw) == 0:
            continue
        image_contents.append(ImageContent(image_base64=base64.b64encode(raw).decode("ascii")))

    if not image_contents:
        raise HTTPException(status_code=400, detail="No valid photos after filtering")

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY missing on server")

    user_id = user.get("id") or "anon"
    session_id = f"ai-measure-{user_id}-{uuid.uuid4().hex[:8]}"

    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=SYSTEM_PROMPT,
    ).with_model("anthropic", MODEL_NAME)

    prompt_parts = [
        f"Workspace: {kind} estimate.",
    ]
    if address:
        prompt_parts.append(f"Property address: {address}")
    if reference_dim:
        prompt_parts.append(
            f"Reference dimension provided by contractor: {reference_dim}. "
            "Anchor all scale to this."
        )
    prompt_parts.append(
        "Photos attached below. Return the JSON measurement object now."
    )
    user_text = "\n".join(prompt_parts)

    try:
        reply_text = await chat.send_message(
            UserMessage(text=user_text, file_contents=image_contents),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI measure call failed: {e}") from e

    raw = _json_from_reply(reply_text or "")
    measurements = _aggregate_to_hover_shape(raw)

    # Re-use the HOVER importer's measurement → catalog-line mapper so the
    # siding/windows estimator can merge AI results identically to a real
    # HOVER PDF.
    try:
        lines = _build_lines(measurements)
    except Exception:
        lines = []

    return {
        "measurements": measurements,
        "lines": lines,
        "vero_openings": [],   # AI photo openings are too rough to size
        "raw_ai": raw,
        "model": MODEL_NAME,
        "session_id": session_id,
    }


@router.post("/map")
async def map_measurements_to_lines(
    payload: dict,
    user: dict = Depends(get_current_user),
):
    """Convert a HOVER-shaped measurements dict directly into siding/windows
    catalog rows — no AI involved. Used by the Photo Measure tool where
    the contractor produces measurements by tapping on a photo and we
    just need the same line mapping HOVER provides."""
    measurements = payload.get("measurements") or {}
    try:
        lines = _build_lines(measurements)
    except Exception:
        lines = []
    return {"measurements": measurements, "lines": lines, "vero_openings": []}
