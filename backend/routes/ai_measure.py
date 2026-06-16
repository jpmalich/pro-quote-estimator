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
  "avg_wall_height_ft": number,           // average EAVE height (floor to where the roof starts), NOT roof peak
  "siding_coverage_pct": number,          // 0-100, % of gross wall area actually clad in siding (NOT brick, stone, etc.)
  "walls": [
    {"label": "front" | "back" | "left" | "right" | "other",
     "width_ft": number,
     "height_ft": number,                 // EAVE height ONLY — measure from floor up to the soffit/gutter line. NEVER include the gable triangle, NEVER include a dormer.
     "gable_triangle_height_ft": number,  // 0 if this wall ends in an eave; >0 ONLY if this wall is a gable-end (you can see the triangular peak above the eave). Triangle area is auto-computed as 0.5 × width × this value.
     "dormer_face_sqft": number,          // 0 unless a true dormer (small box poking out of the roof) is on this elevation. Estimate the visible vertical face area in ft² — typically 20-60 ft² each.
     "siding_pct_this_wall": number       // 0-100 — siding only, not brick/garage door/etc.
    }
  ],
  "openings": [
    {"type": "window" | "entry_door" | "patio_door" | "garage_door" | "vent" | "other",
     "width_in": number, "height_in": number, "wall": "front"|"back"|"left"|"right"|"other"}
  ],
  "eaves_lf": number,          // sum of horizontal soffit/gutter run, linear feet
  "rakes_lf": number,          // sum of sloped roof edges, linear feet (= the rake legs of every gable triangle)
  "starter_lf": number,        // linear feet of starter strip at the base of the siding (typically ≈ eaves_lf for a basic 1-story; can differ on porches, walk-outs, or multi-section homes)
  "outside_corner_lf": number, // linear feet of OUTSIDE corner posts visible across all elevations (typically 4 corners × wall height on a simple rectangular house)
  "inside_corner_lf": number,  // linear feet of INSIDE corner posts (L-shaped wing additions, dormers, returns — often 0 for a basic rectangle)
  "notes": "<1-2 sentences flagging anything the contractor should verify>"
}

CRITICAL accuracy rules (read every time):

0. ONLY COUNT WHAT YOU SEE. If the contractor uploaded 2 photos (e.g. side
   + back), do NOT mirror-extrapolate the front or other side. Return walls
   ONLY for the elevations clearly visible in the supplied photos. In notes
   say which elevations are MISSING so the contractor knows to add them.
   Never inflate `walls[]` by guessing unseen sides.

1. SCALE: If the contractor provided ANY reference dimension (door width,
   wall width, garage height, brick course), anchor scale to it and set
   scale_confidence to "high". When you compute wall area, use the
   contractor-provided width VERBATIM — do not round it.

2. STORY COUNT vs WALL HEIGHT — read carefully, this is the #1 source
   of inflated quotes:
   • "Story count" = number of FULL floors of rectangular wall, floor to
     the eave line where the roof starts. A gable peak is NOT a story.
     A dormer is NOT a story.
   • `height_ft` on each wall is the EAVE height, NOT the roof peak.
     If you see a triangular gable end on the back of the house, the
     wall is STILL 1-story tall (e.g. 9 ft); the triangle on top goes
     into `gable_triangle_height_ft`, NOT height_ft.
   • A dormer is a small box-shaped projection out of the roof slope,
     usually with one window and 2-4 ft of vertical face. A dormer DOES
     NOT change the underlying wall height. Record dormer face area in
     `dormer_face_sqft` on the elevation the dormer faces.
   • Cues that signal a TRUE second story (not a dormer / not a gable):
       - Continuous horizontal row of windows ABOVE the first-floor windows,
         spanning most of the wall width
       - The eave line itself is high (~18 ft) — you can see the soffit
         well above the first-floor window heads
       - The 2nd floor windows are the same size as the 1st floor windows
   • Cues that mean it's a DORMER (not a 2nd story):
       - Only 1 or 2 small windows poking out of the roof slope
       - The roof slope is clearly visible on either side of the window box
       - The window is set back from the main wall face
   • Cues that mean it's a GABLE (not a 2nd story):
       - The wall ends in a triangle that meets a peak
       - There are NO windows above the eave line (or only a single
         small vent/gable window)
   Default story heights:
     1 story:    9 ft eave height
     1.5 story: 12 ft (with kneewall) — used for Cape Cod / story-and-a-half
     2 story:  18 ft
   Use these ONLY when the photos clearly show that story count. If
   uncertain between 1-story-with-gable and true 2-story, ALWAYS bias
   to 1-story-with-gable and flag it in notes.

3. GABLE TRIANGLES vs WALL HEIGHT: When a wall is a gable-end (you can
   see the triangle), the rectangular wall area is `width × eave_height`
   and the triangle area is auto-computed downstream as
   `0.5 × width × gable_triangle_height`. NEVER bake the triangle into
   `height_ft`. Typical residential gable_triangle_height_ft is 4-8 ft
   for a 6/12 to 9/12 pitch on a 24-32 ft wide house.

4. DORMERS: Do not include dormer area in `height_ft`. Use
   `dormer_face_sqft` (typically 20-60 ft² each) so the contractor sees
   a separate line of accountability. If a wall has 2 dormers, sum them.

5. SIDING COVERAGE: A wall area is NOT the same as a siding area.
   Examine every wall for:
     - Brick / stone wainscot or full-wall masonry (NO siding)
     - Garage doors (NO siding behind them)
     - Stucco / EIFS panels (NO siding)
   For each wall, set siding_pct_this_wall to the visible fraction of
   the wall actually clad in siding. Compute the global
   siding_coverage_pct as a weighted average. If a house is 100% siding,
   that's fine — but DON'T assume it.

6. CONSERVATIVE BIAS: When in doubt, under-estimate. Contractors over-buy
   to cover waste; you don't need to add buffer. If your math gives a
   range, return the LOW end and flag it in notes.

7. SHOW YOUR WORK: In notes, briefly explain:
   "Back wall: 28 × 9 = 252 ft² rectangle + 28 × 6 / 2 = 84 ft² gable
   triangle. Right wall: 36 × 9 = 324 ft² with a 32 ft² dormer face."
   This forces you to keep the geometry honest.

8. ROUNDING: Walls to nearest 0.5 ft. Openings to nearest 2 in. Final
   siding area to nearest 10 ft².

9. WHAT TO RETURN as siding_sqft (computed downstream from your walls):
   ONLY the portion of wall area that's actually siding (after applying
   siding_pct_this_wall per wall). Gable triangles + dormer faces are
   added on top at 100% siding (unless you flag them as masonry).
   Do not include brick/garage/etc.

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

    Each wall now carries:
      - `siding_pct_this_wall` (0-100). If Claude saw brick / garage /
        stucco on part of a wall, that fraction is dropped — otherwise
        the legacy 100% siding behavior holds.
      - `gable_triangle_height_ft` (0+). When non-zero, an additional
        0.5 × width × height triangle is added on top of the eave wall.
      - `dormer_face_sqft` (0+). Vertical face area of any dormers
        projecting from the roof slope — added as an extra to siding.
    """
    walls = raw.get("walls") or []
    openings = raw.get("openings") or []

    siding_sqft = 0.0
    gable_sqft = 0.0
    dormer_sqft = 0.0
    for w in walls:
        width_ft = float(w.get("width_ft") or 0)
        eave_h = float(w.get("height_ft") or 0)
        gross = width_ft * eave_h
        pct = float(w.get("siding_pct_this_wall") or 100.0)
        # Clamp to a sane range and treat null/zero defensively as 100%.
        if pct <= 0:
            pct = 100.0
        pct = min(pct, 100.0)
        siding_sqft += gross * (pct / 100.0)
        # Gable triangle (only when Claude flagged this wall as a gable
        # end). The triangle is assumed 100% siding unless the
        # contractor manually overrides on the line item later.
        gable_h = float(w.get("gable_triangle_height_ft") or 0)
        if gable_h > 0 and width_ft > 0:
            gable_sqft += 0.5 * width_ft * gable_h
        # Dormers — already in ft², no width math needed.
        dormer_sqft += float(w.get("dormer_face_sqft") or 0)
    # Add gable + dormer extras on top of the masonry-adjusted siding.
    siding_sqft += gable_sqft + dormer_sqft
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
        # Starter strip: AI value if Claude gave one, otherwise fall back
        # to eaves_lf since the starter perimeter runs along the same base
        # course as the eaves on a basic 1-story rectangle. The contractor
        # can adjust on the line item if the house has porches / walk-outs.
        "starter_lf": round(float(raw.get("starter_lf") or raw.get("eaves_lf") or 0), 1),
        # Corners — AI estimates from visible elevations. Fall back to a
        # reasonable default for a basic rectangular house (4 outside
        # corners × avg wall height, 0 inside corners).
        "outside_corner_lf": round(float(
            raw.get("outside_corner_lf")
            or 4 * float(raw.get("avg_wall_height_ft") or 0)
        ), 1),
        "inside_corner_lf": round(float(raw.get("inside_corner_lf") or 0), 1),
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
        # Iter 47: surface gable + dormer breakdown so the preview UI can
        # show "Rect walls: 1,840 ft² · Gables: 168 ft² · Dormers: 60 ft²"
        # and the contractor can sanity-check the geometry before applying.
        "_ai_gable_sqft": round(gable_sqft, 1),
        "_ai_dormer_sqft": round(dormer_sqft, 1),
        "_ai_notes": raw.get("notes") or "",
    }
    return measurements


@router.post("/ai-measure")
async def ai_measure(
    files: list[UploadFile] = File(...),
    reference_dim: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    kind: str = Form("siding"),
    overhang_in: float = Form(12.0),
    user: dict = Depends(get_current_user),
):
    """Run an AI photo-measure pass on 2-8 uploaded photos.

    `overhang_in` (inches) flows into the soffit piece-count formula so
    the imported qty matches the estimate's current Overhang setting.
    """
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
    measurements["overhang_in"] = float(overhang_in)

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
