"""AI Blueprint Reader — pull a takeoff from architectural plans.

Sister endpoint to /api/measure/ai-measure. Where ai-measure looks at a
photo of the house and *estimates* dimensions (±10–30%), this endpoint
*reads* the dimensions printed on a blueprint or plan PDF — so the
output is as accurate as the drawing itself.

Endpoint: POST /api/measure/ai-blueprint  (multipart/form-data)
Form fields:
  file:           one multi-page PDF (preferred — blueprint set)
  files:          OR one or more JPG/PNG image scans of plan sheets
  address:        optional context for Claude's reply
  overhang_in:    soffit overhang for the piece-count formula
  max_pages:      cap on PDF page count to send (default 12, max 20)

Output matches /api/measure/ai-measure exactly:
  { measurements, lines, vero_openings, mezzo_openings, raw_ai, model }

A blueprint set typically has:
  • Cover sheet / title block (scale, project address)
  • Site plan (lot, setbacks — we ignore)
  • Floor plan (perimeter dims, RO callouts at each window — KEY for windows)
  • Elevations: front / rear / left / right (wall heights, gable rises)
  • Roof plan (eave + rake LF)
  • Window / Door Schedule (the table — KEY for exact counts + RO sizes)

Cost: blueprint sheets are PNGs at ~200 DPI → ~3–6 MB each. A typical 6-sheet
set costs ~$0.40–$0.60 in Opus 4.5 vision charges. We surface page-count
in the response so the contractor can see what was billed.
"""
from __future__ import annotations

import base64
import io
import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import pypdfium2 as pdfium
from PIL import Image
from emergentintegrations.llm.chat import (
    ImageContent,
    LlmChat,
    UserMessage,
)
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from deps import get_current_user
from db import db
from routes.hover import _build_lines, _build_window_openings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/measure", tags=["measure"])

ACCEPTED_IMG_MIMES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
ACCEPTED_PDF_MIMES = {"application/pdf"}
MAX_PAGES_HARD = 20
DEFAULT_MAX_PAGES = 12
MAX_BYTES_PER_FILE = 16 * 1024 * 1024  # blueprints scan larger than photos
PDF_RENDER_SCALE = 2.0  # pypdfium2 scale factor — ~144 DPI for an 8.5×11
MODEL_NAME = "claude-opus-4-5-20251101"


SYSTEM_PROMPT = """\
You are an expert residential blueprint reader for a vinyl-siding and
window contractor. The user uploads scans / PDF exports of an architectural
plan set. Your job is to READ (not estimate) the printed dimensions and
return a takeoff JSON that drives a quote.

You MUST return JSON only — no prose, no markdown fences.

RESIDENTIAL PLAN NOTATION YOU MUST UNDERSTAND:

1. Window / Door RO sizes are written one of these ways:
     "3-6 5-0"       → 3'-6" wide × 5'-0" tall  → 42" × 60"
     "3'-6\" 5'-0\""  → same
     "3050"          → 3'-0" × 5'-0"  → 36" × 60"  (4-digit shorthand: first 2 digits = feet-inches of width, last 2 = feet-inches of height)
     "3068"          → 3'-0" × 6'-8"  → 36" × 80"  (door shorthand: 6'-8" is standard residential door height)
     "30 X 60"       → 30" wide × 60" tall (inches — already explicit)
     "2868" / "3068" / "6068" → standard door codes (last 2 digits = 6'-8" door height); 6068 = 6'-0" double door
   When you see one of these next to a window/door symbol on the FLOOR PLAN,
   parse it into width_in + height_in. The 4-digit form is the most
   ambiguous — verify by checking that height makes sense (60–84" for
   windows, 78–84" for doors).

2. Floor-plan dimension strings like "24'-0\"" or "24-0" or "24' 0\"" or "24.0'"
   all mean 24 feet. Convert to decimal feet (24.0).

3. Sheet titles to look for:
   • "FLOOR PLAN" / "1ST FLOOR" / "2ND FLOOR" → for perimeter + RO callouts
   • "FRONT ELEVATION" / "REAR" / "LEFT" / "RIGHT" / "SIDE" → for wall heights + gable rises
   • "ROOF PLAN" → for eave / rake linear feet
   • "WINDOW SCHEDULE" / "DOOR SCHEDULE" → THE most accurate source for
     window/door counts and RO sizes. If a schedule is present, USE IT —
     it overrides whatever you counted on the floor plan.

4. Scale callouts: "1/4\" = 1'-0\"" or "SCALE 1/4 IN = 1 FT" → only
   needed if dimensions are missing; you should rely on the printed
   dim strings, not on measuring pixels.

EXTRACTION SCHEMA — return EXACTLY this shape:
{
  "sheets_identified": [
    {"page": 1, "sheet_title": "<best guess>", "useful_for": "elevation|floor_plan|schedule|roof|cover|other"}
  ],
  "scale_confidence": "high" | "medium" | "low",
  "story_count": 1 | 1.5 | 2 | 2.5 | 3,
  "avg_wall_height_ft": number,           // EAVE height, read from elevation
  "walls": [
    {"label": "front" | "back" | "left" | "right",
     "width_ft": number,                  // read from floor plan or elevation
     "height_ft": number,                 // EAVE height (not roof peak)
     "gable_triangle_height_ft": number,  // 0 unless this wall is a gable end
     "dormer_face_sqft": number,          // 0 unless dormer shown on this elevation
     "siding_pct_this_wall": 100,         // INTEGER percent; default 100 unless plan notes brick/stone
     // Iter 78z — Profile callouts read from the elevation drawing itself.
     // Construction prints almost always print the siding type in plain
     // text on or near the surface (e.g. "LAP 4\"", "DUTCH LAP", "SHAKER",
     // "B&B", "STONE WATERTABLE"). Capture them verbatim — the catalog
     // mapper splits the line by callout so mixed-material houses
     // (Campbell-style) produce SEPARATE SHAKE / B&B / LAP quote lines
     // instead of collapsing into a single inflated lap number.
     "wall_body_profile_callout": "<verbatim text from the elevation showing the wall body siding (e.g. 'LAP 4\"', 'DUTCH LAP 5\"', 'VINYL'); leave empty if not labelled>",
     "gable_profile_callout":     "<verbatim text for the gable triangle's siding (e.g. 'SHAKER', 'SHAKE', 'B&B', 'BOARD AND BATTEN'); empty if gable matches the wall body or wall isn't a gable end>",
     "dormer_profile_callout":    "<verbatim text for any dormer face siding (e.g. 'SHAKER', 'B&B'); empty if no dormer or dormer matches body>",
     "stone_callout":             "<'STONE WATERTABLE' or similar if the elevation shows a masonry watertable / wainscot below the siding line; empty if all siding>",
     // Iter 78z+ — ACCENT PANELS. A single wall can carry SMALL accent
     // areas with a different profile from the body — these are easy to
     // miss because they don't fit the "body / gable / dormer" buckets.
     // Examples seen on Howard's jobs: B&B on a porch face, shake on
     // column wraps, vertical siding on a bay-window cheek, fish-scale
     // on an entry gable above the porch. Capture every accent you can
     // see on THIS wall. Leave empty if the wall is uniform.
     "accent_profiles": [
       {"location": "<short description, e.g. 'porch face', 'column wrap', 'bay window cheek', 'entry gable', 'kneewall'>",
        "profile_callout": "<verbatim text or pattern (e.g. 'B&B', 'BOARD AND BATTEN', 'SHAKE', 'VERTICAL')>",
        "approx_sqft": number}
     ]
    }
  ],
  "windows": [
    // Each row in the Window Schedule (or each callout on the floor plan).
    // If both are present, prefer the schedule and dedupe by mark.
    {"id": "<mark like 'W1' or 'A' or blank>",
     "width_in": number,                  // parse 3-6 → 42, 3050 → 36, etc.
     "height_in": number,
     "qty": 1,                            // increment if schedule shows multiple
     "type_hint": "double_hung|casement|slider|picture|fixed|awning|unknown"
    }
  ],
  "doors": [
    // Same shape as windows, but for exterior doors only (front entry,
    // patio sliders, garage). Interior doors are IGNORED.
    {"id": "<mark>",
     "width_in": number,
     "height_in": number,
     "qty": 1,
     "type_hint": "entry|patio_slider|patio_french|garage|unknown"
    }
  ],
  "eaves_lf": number,          // sum of widths of EAVE walls only (i.e. walls where gable_triangle_height_ft == 0). For a typical gable-roof house with gables on front + back, this = left wall width + right wall width — NOT the full perimeter. Only equals the full perimeter when the roof is a hip (every wall has gable_triangle_height_ft = 0).
  "rakes_lf": number,          // sum of sloped roof edges = 2 × √((wall_width/2)² + gable_triangle_height_ft²) summed over each gable wall
  "starter_lf": number,        // ≈ eaves_lf for basic 1-story; differs on walk-outs
  "outside_corner_count": number, // INTEGER. Number of OUTSIDE corner locations on the floor plan. See "CORNER COUNTING" rule below.
  "outside_corner_lf": number, // = outside_corner_count × avg_wall_height_ft. Each corner trim runs the full eave height.
  "inside_corner_count": number,  // INTEGER. Number of INSIDE corner locations on the floor plan. Default is NOT 0 — walk the perimeter and count.
  "inside_corner_lf": number,  // = inside_corner_count × avg_wall_height_ft.
  "notes": "<2-3 sentences flagging anything to verify — missing dims, illegible numbers, etc.>"
}

CORNER COUNTING (read this carefully — this is where most readers
get the takeoff wrong):

Walk the floor-plan perimeter CLOCKWISE starting from any corner. At
every change of direction, classify the corner:

  • OUTSIDE corner (convex / 90° projecting outward) — the wall turns
    AWAY from the interior. From inside the house this corner looks
    like a 90° bend pointing OUT toward the yard. A simple rectangular
    house has exactly 4 outside corners. An L-shape has 5 outside
    corners. A T-shape has 6.

  • INSIDE corner (concave / 270° receding inward) — the wall turns
    TOWARD the interior. From inside the house this corner looks like
    a notch / armpit pointing IN. A simple rectangle has 0 inside
    corners. An L-shape has 1 inside corner. A T-shape has 2.

INVARIANT — verify this before returning:
  (outside_corner_count − inside_corner_count) MUST equal 4 for any
  closed building footprint. If your counts don't satisfy this,
  RE-WALK the perimeter — you mis-classified at least one corner.

Examples:
  • Pure rectangle:           4 outside, 0 inside  → 4 − 0 = 4 ✓
  • L-shape (one wing):       5 outside, 1 inside  → 5 − 1 = 4 ✓
  • T-shape (two wings):      6 outside, 2 inside  → 6 − 2 = 4 ✓
  • U-shape:                  6 outside, 2 inside  → 6 − 2 = 4 ✓
  • Cross / plus footprint:   8 outside, 4 inside  → 8 − 4 = 4 ✓
  • Footprint with bump-out:  6 outside, 2 inside  → 6 − 2 = 4 ✓

DO NOT default inside_corner_count to 0 unless you have walked the
perimeter and confirmed the footprint is a pure rectangle. Bump-outs,
breakfast nooks, mudroom additions, garage bumpouts, and L-wings ALL
create inside corners.

CRITICAL RULES:

A. PREFER PRINTED DIMS OVER ESTIMATION. If the floor plan shows "32'-0\""
   along the front wall, the front wall width is 32.0 ft — never round
   it to 30 or 35. If a dim is missing or illegible, set the wall to
   the best inferred value and FLAG IT in notes.

B. WINDOW / DOOR SCHEDULE WINS. If a schedule sheet is present, the
   `windows` and `doors` arrays must reflect THE SCHEDULE exactly — same
   quantities, same RO sizes. The floor-plan callouts are only the
   tie-breaker when the schedule omits a mark.

C. PARSE "3-6 5-0" AS WIDTH-HEIGHT IN FEET-INCHES. The first pair is
   ALWAYS width, the second pair is ALWAYS height. Convert each pair to
   inches: e.g. 3-6 → 3*12 + 6 = 42, 5-0 → 5*12 = 60. NEVER swap them.
   The 4-digit form "3050" is the SAME pattern: first 2 digits → 3-0,
   last 2 digits → 5-0. Confirm by sanity-checking the result:
     - Window heights are 36–84" (most are 48–72")
     - Door heights are 78–84"
   If your parse gives a window 96" tall, you parsed it wrong.

D. STORY COUNT IS DETERMINED BY THE ELEVATIONS, NOT THE FLOOR PLAN. If
   you see a 2nd-floor plan sheet, the house is 2-story (or 1.5). If
   the elevation shows one row of windows under the eave, it's 1-story.

E. SIDING vs MASONRY: Plans often callout "BRICK VENEER" or "STONE
   WAINSCOT TO 36\"". Reflect these by reducing siding_pct_this_wall
   (e.g. brick wainscot to 36" on a 9 ft wall → ~67% siding above).
   When in doubt, assume 100% siding and flag in notes.

F. PROFILE CALLOUTS PER ELEVATION (Iter 78z — REQUIRED):
   Construction prints almost always print the siding profile in plain
   text directly on (or near) the siding surface — common labels are
   "LAP 4\"", "DUTCH LAP", "VINYL", "SHAKER", "SHAKE", "B&B",
   "BOARD AND BATTEN", "VERTICAL", "NICKEL GAP", "STONE WATERTABLE".
   For every elevation page, capture FOUR distinct callouts:
     1. `wall_body_profile_callout` — the main field of the wall
     2. `gable_profile_callout`     — only if there's a visible gable
                                        triangle on this elevation
     3. `dormer_profile_callout`    — only if there's a dormer
     4. `accent_profiles[]`         — SMALL accent zones with a
                                        DIFFERENT profile from the body
                                        (porch face B&B, column wrap
                                        shake, bay-window cheek
                                        vertical, kneewall B&B, entry-
                                        roof gable shake). Estimate the
                                        approx ft² for each accent.
   ACCENT ZONES ARE THE #1 SOURCE OF UNDER-QUOTING on Howard's mixed-
   material houses. A single 24"-wide B&B porch face costs ~$80 in
   material — miss it on 20% of jobs and you lose real money. Look
   for any printed text or any visible texture/pattern that differs
   from the main wall body. Always include accents you suspect, even
   if you're uncertain.

F. ROUNDING:
     - Wall widths to nearest 0.5 ft
     - Wall heights to nearest 0.5 ft
     - Window/door RO sizes to the nearest inch (parsed exactly from plan)
     - Eaves/rakes to nearest 1 ft

G. IF A SHEET IS NOT USEFUL (cover, site plan, foundation plan, electrical),
   list it in sheets_identified with useful_for="other" and ignore it.

H. NEVER FABRICATE. If you can't find a window schedule and the floor
   plan callouts are illegible, return windows=[] and flag it in notes —
   do NOT invent placeholder windows.

Return ONLY the JSON object. No explanation, no code fences."""


def _json_from_reply(text: str) -> dict:
    """Pull the first {...} JSON object out of Claude's reply."""
    text = (text or "").strip()
    fence = re.match(r"^```(?:json)?\s*(\{.*\})\s*```$", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < 0 or end <= start:
        raise HTTPException(status_code=502, detail="AI did not return JSON")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")


def _compress_for_claude(img_bytes: bytes, max_raw_bytes: int = 5_500_000) -> bytes:
    """Ensure a single image fits comfortably under Anthropic's 10 MB
    base64 limit. Anthropic measures the base64 string (~1.33× raw),
    so we target raw bytes < ~5.5 MB → base64 < ~7.3 MB with headroom.

    Strategy: JPEG-encode at q=88, then if still too large iteratively
    downscale by 0.85× and re-encode (q=85 → q=78 → q=70). Returns the
    smallest viable JPEG bytes. Falls back to the original bytes if PIL
    fails or the image is already small enough.
    """
    if len(img_bytes) <= max_raw_bytes and img_bytes[:3] == b"\xff\xd8\xff":
        # Already a small JPEG, no work needed.
        return img_bytes
    try:
        with Image.open(io.BytesIO(img_bytes)) as im:
            # Convert anything alpha/palette-mode into RGB so JPEG works.
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            qualities = [88, 85, 78, 70, 60]
            scales = [1.0, 0.85, 0.72, 0.6, 0.5, 0.42]
            for scale in scales:
                if scale < 1.0:
                    new_w = max(800, int(im.width * scale))
                    new_h = max(800, int(im.height * scale))
                    work = im.resize((new_w, new_h), Image.LANCZOS)
                else:
                    work = im
                for q in qualities:
                    buf = io.BytesIO()
                    work.save(buf, format="JPEG", quality=q, optimize=True)
                    data = buf.getvalue()
                    if len(data) <= max_raw_bytes:
                        return data
            # Last resort — return whatever the lowest-quality smallest
            # scale produced (still better than the original PNG).
            return data  # noqa: F821 — defined inside the loop
    except Exception:
        logger.exception("[ai-blueprint] image compression failed; sending original")
        return img_bytes


def _render_pdf_to_pngs(raw_pdf: bytes, max_pages: int) -> list[bytes]:
    """Rasterize a PDF into a list of PNG byte-strings, one per page,
    capped at `max_pages`. Each page is rendered at PDF_RENDER_SCALE so
    Claude can read printed dim text clearly."""
    out: list[bytes] = []
    try:
        doc = pdfium.PdfDocument(raw_pdf)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid PDF: {e}") from e
    page_count = min(len(doc), max_pages)
    for i in range(page_count):
        page = doc[i]
        try:
            pil_image = page.render(scale=PDF_RENDER_SCALE).to_pil()
            buf = io.BytesIO()
            pil_image.save(buf, format="PNG", optimize=True)
            # Compress to fit under Anthropic's 10 MB base64 cap. Blueprints
            # rendered at scale=2.0 routinely produce 8–15 MB PNGs that
            # explode past the limit once base64-encoded.
            out.append(_compress_for_claude(buf.getvalue()))
        finally:
            page.close()
    doc.close()
    return out


def _aggregate_to_hover_shape(raw: dict, annotations: dict | None = None) -> dict:
    """Roll Claude's blueprint extraction into the same measurements dict
    the rest of the app speaks. Mirrors the photo-measure aggregator but
    uses the printed dims at face value (no defensive clamps — the
    contractor can see the raw Claude JSON in the preview to verify)."""
    walls = raw.get("walls") or []
    windows = raw.get("windows") or []
    doors = raw.get("doors") or []

    siding_sqft = 0.0
    gable_sqft = 0.0
    dormer_sqft = 0.0
    for w in walls:
        width_ft = float(w.get("width_ft") or 0)
        eave_h = float(w.get("height_ft") or 0)
        gross = width_ft * eave_h
        pct = float(w.get("siding_pct_this_wall") or 100.0)
        # Same fraction-vs-percent defensiveness as the photo aggregator.
        if 0 < pct < 1:
            pct = pct * 100.0
        if pct <= 0:
            pct = 100.0
        pct = min(pct, 100.0)
        siding_sqft += gross * (pct / 100.0)
        gh = float(w.get("gable_triangle_height_ft") or 0)
        if gh > 0 and width_ft > 0:
            gable_sqft += 0.5 * width_ft * gh
        dormer_sqft += float(w.get("dormer_face_sqft") or 0)
    siding_sqft += gable_sqft + dormer_sqft

    # Door type → opening-count bucket
    counts = {"window": 0, "entry_door": 0, "patio_door": 0, "garage_door": 0}
    opening_sqft = 0.0
    perimeter_lf = 0.0
    for win in windows:
        try:
            qty = max(1, int(win.get("qty") or 1))
        except (TypeError, ValueError):
            qty = 1
        counts["window"] += qty
        w_in = float(win.get("width_in") or 0)
        h_in = float(win.get("height_in") or 0)
        opening_sqft += qty * (w_in * h_in) / 144.0
        perimeter_lf += qty * 2 * ((w_in + h_in) / 12.0)
    for d in doors:
        t = (d.get("type_hint") or "").lower()
        if "garage" in t:
            bucket = "garage_door"
        elif "patio" in t:
            bucket = "patio_door"
        else:
            bucket = "entry_door"
        try:
            qty = max(1, int(d.get("qty") or 1))
        except (TypeError, ValueError):
            qty = 1
        counts[bucket] += qty
        w_in = float(d.get("width_in") or 0)
        h_in = float(d.get("height_in") or 0)
        opening_sqft += qty * (w_in * h_in) / 144.0
        perimeter_lf += qty * 2 * ((w_in + h_in) / 12.0)

    # Expand schedule rows into a per-opening list (qty=1 each) so
    # _build_window_openings sees one row per physical window. Matches
    # the HOVER importer's contract.
    expanded_windows = []
    for win in windows:
        try:
            qty = max(1, int(win.get("qty") or 1))
        except (TypeError, ValueError):
            qty = 1
        for n in range(qty):
            mark = str(win.get("id") or "").strip()
            label = f"{mark}-{n + 1}" if (qty > 1 and mark) else (mark or f"W-{uuid.uuid4().hex[:4]}")
            expanded_windows.append({
                "id": label,
                "width_in": float(win.get("width_in") or 0),
                "height_in": float(win.get("height_in") or 0),
            })

    # Iter 57w — Defensive eaves_lf override. Claude historically returns
    # the full floor-plan perimeter as eaves_lf, which is only correct
    # for hip roofs. On a typical gable-roof house gutters run only on
    # the non-gable walls (eave walls). When any wall is flagged as a
    # gable (`gable_triangle_height_ft > 0`), recompute eaves_lf as the
    # sum of widths of NON-gable walls. This drops the gable ends from
    # the gutter coil + downspout count + elbow count downstream.
    any_gable = any(float(w.get("gable_triangle_height_ft") or 0) > 0 for w in walls)
    if any_gable:
        corrected_eaves = sum(
            float(w.get("width_ft") or 0)
            for w in walls
            if float(w.get("gable_triangle_height_ft") or 0) <= 0
        )
        if corrected_eaves > 0:
            raw["eaves_lf"] = corrected_eaves

    measurements = {
        "siding_sqft": round(siding_sqft, 1),
        "siding_with_openings_sqft": round(siding_sqft, 1),
        "opening_sqft": round(opening_sqft, 1),
        "eaves_lf": round(float(raw.get("eaves_lf") or 0), 1),
        "rakes_lf": round(float(raw.get("rakes_lf") or 0), 1),
        "starter_lf": round(float(raw.get("starter_lf") or raw.get("eaves_lf") or 0), 1),
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
        # Feed the Windows-workspace populator. Same shape HOVER produces.
        "windows": expanded_windows,
        # Surfaced fields for the preview UI
        "_ai_scale_confidence": raw.get("scale_confidence") or "low",
        "_ai_reference_used": "blueprint dimensions",
        "_ai_story_count": raw.get("story_count"),
        "_ai_avg_wall_height_ft": raw.get("avg_wall_height_ft"),
        "_ai_gable_sqft": round(gable_sqft, 1),
        "_ai_dormer_sqft": round(dormer_sqft, 1),
        "_ai_notes": raw.get("notes") or "",
        "_blueprint_sheets": raw.get("sheets_identified") or [],
    }
    # Iter 78z (P1.2) — Per-elevation profile breakdown so the catalog
    # mapper can split siding into per-profile SKU lines AND so the
    # frontend can render a per-elevation breakdown card. Mirrors the
    # AI Measure aggregator (see routes/ai_measure.py).
    try:
        from profile_callouts import breakdown_walls_by_profile, apply_annotations_to_breakdown
        breakdown = breakdown_walls_by_profile(walls)
        breakdown = apply_annotations_to_breakdown(breakdown, annotations)
        measurements["_per_elevation_breakdown"] = breakdown["per_elevation"]
        measurements["_per_profile_sqft"] = breakdown["per_profile_sqft"]
    except Exception:
        measurements["_per_elevation_breakdown"] = []
        measurements["_per_profile_sqft"] = {}
    return measurements


@router.post("/ai-blueprint")
async def ai_blueprint(
    file: Optional[UploadFile] = File(None),
    files: list[UploadFile] = File(default=[]),
    address: Optional[str] = Form(None),
    overhang_in: float = Form(12.0),
    max_pages: int = Form(DEFAULT_MAX_PAGES),
    # Iter 57r — Resume support
    estimate_id: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    """Read a blueprint set and return a takeoff in the same shape AI Measure
    produces. Accepts either a multi-page PDF (`file`) or several scanned
    image sheets (`files`). At least one of the two must be present."""
    if max_pages <= 0 or max_pages > MAX_PAGES_HARD:
        max_pages = DEFAULT_MAX_PAGES

    image_payloads: list[bytes] = []

    # Iter 78z+ (Blueprint annotator) — also persist each rendered page
    # to UPLOAD_DIR so the frontend ProfileAnnotator can display them
    # back to the contractor. Same pattern as AI Measure's photo_paths.
    from config import UPLOAD_DIR  # local import to dodge cycle
    page_paths: list[str] = []

    def _persist_page_png(png_bytes: bytes) -> str:
        name = f"bp_{uuid.uuid4().hex}.png"
        target = UPLOAD_DIR / name
        target.write_bytes(png_bytes)
        return name

    # PDF path — render to PNGs
    if file is not None:
        ctype = (file.content_type or "").lower()
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty PDF upload")
        # Some browsers send application/octet-stream; sniff by header too.
        is_pdf = ctype in ACCEPTED_PDF_MIMES or raw[:5] == b"%PDF-"
        if not is_pdf:
            raise HTTPException(
                status_code=400,
                detail=f"Expected PDF for `file`, got {ctype!r}",
            )
        if len(raw) > MAX_BYTES_PER_FILE * 4:
            raise HTTPException(status_code=413, detail="PDF exceeds 64 MB limit")
        page_pngs = _render_pdf_to_pngs(raw, max_pages)
        for png in page_pngs:
            try:
                page_paths.append(_persist_page_png(png))
            except Exception:
                # If disk write fails we still want Claude to see the
                # page — we just lose the annotator preview for it.
                page_paths.append("")
        image_payloads.extend(page_pngs)

    # Image-scan path
    if files:
        for f in files:
            ctype = (f.content_type or "").lower()
            if ctype not in ACCEPTED_IMG_MIMES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type {ctype!r} for `files` — use JPG, PNG, or WEBP",
                )
            raw = await f.read()
            if not raw:
                continue
            if len(raw) > MAX_BYTES_PER_FILE:
                raise HTTPException(status_code=413, detail="Plan sheet exceeds 16 MB limit")
            # Same Anthropic 10 MB base64 cap — compress before queuing.
            compressed = _compress_for_claude(raw)
            image_payloads.append(compressed)
            # Persist a copy for the annotator UI. We save the COMPRESSED
            # version since that's what Claude sees — keeps box coords
            # aligned with what was analyzed.
            try:
                page_paths.append(_persist_page_png(compressed))
            except Exception:
                page_paths.append("")

    if not image_payloads:
        raise HTTPException(
            status_code=400,
            detail="Provide either a PDF blueprint (`file`) or one or more image scans (`files`)",
        )
    if len(image_payloads) > MAX_PAGES_HARD:
        # Already capped on the PDF side, but guard against image overflow too.
        image_payloads = image_payloads[:MAX_PAGES_HARD]

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY missing on server")

    user_id = user.get("id") or "anon"
    run_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    # Iter 57q-bp — async launcher pattern. Same fix as the AI Measure
    # route: synchronous Claude calls on big blueprint sets were
    # exceeding the Kubernetes ingress timeout (~100 s) and triggering
    # the Cloudflare 524 error. Now the route persists a `running` doc
    # and returns a run_id immediately; the worker writes the result
    # back when Claude finishes (no time cap).
    await db.ai_blueprint_runs.insert_one({
        "run_id": run_id,
        "user_id": user_id,
        "estimate_id": estimate_id,
        "status": "running",
        "stage": "starting",
        "page_count": len(image_payloads),
        # Iter 78z+ — persisted page filenames (one per rendered/uploaded
        # blueprint page) so the ProfileAnnotator UI can display them
        # for box-tagging. Order matches `image_payloads` (and therefore
        # photos[*].index in Claude's output).
        "page_paths": ",".join(p for p in page_paths if p),
        "address": address,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
        "result": None,
        "error": None,
    })
    asyncio.create_task(_execute_ai_blueprint_worker(
        run_id=run_id,
        image_payloads=image_payloads,
        api_key=api_key,
        user_id=user_id,
        address=address,
        overhang_in=overhang_in,
        estimate_id=estimate_id,
    ))
    return {
        "run_id": run_id,
        "status": "running",
        "stage": "starting",
        "pages_queued": len(image_payloads),
        # Iter 78z+ — return the persisted page filenames so the
        # frontend can hand them to the ProfileAnnotator immediately
        # (no need to wait for the worker to finish).
        "page_paths": ",".join(p for p in page_paths if p),
    }


@router.get("/ai-blueprint/status/{run_id}")
async def ai_blueprint_status(
    run_id: str,
    user: dict = Depends(get_current_user),
):
    """Poll the status of an async blueprint-read run. Mirrors the
    `/measure/ai-measure/status/{run_id}` shape."""
    doc = await db.ai_blueprint_runs.find_one({"run_id": run_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Run not found")
    if doc.get("user_id") not in (user.get("id"), "anon"):
        raise HTTPException(status_code=403, detail="Not your run")
    created = doc.get("created_at")
    completed = doc.get("completed_at") or doc.get("updated_at")
    elapsed_ms = None
    if isinstance(created, datetime):
        ref = completed if isinstance(completed, datetime) else datetime.now(timezone.utc)
        elapsed_ms = int((ref - created).total_seconds() * 1000)
    return {
        "run_id": run_id,
        "status": doc.get("status"),
        "stage": doc.get("stage"),
        "result": doc.get("result"),
        "error": doc.get("error"),
        "elapsed_ms": elapsed_ms,
    }


@router.get("/ai-blueprint/latest-for-estimate/{estimate_id}")
async def ai_blueprint_latest_for_estimate(
    estimate_id: str,
    user: dict = Depends(get_current_user),
):
    """Iter 57r — same Resume support as the AI Measure endpoint.
    Returns the most recent blueprint run for this user+estimate."""
    user_id = user.get("id") or "anon"
    doc = await db.ai_blueprint_runs.find_one(
        {"user_id": user_id, "estimate_id": estimate_id},
        sort=[("created_at", -1)],
    )
    if not doc:
        return {"run": None}
    # Iter 57x — same offset-aware safety fix that ai_measure has.
    # Mongo returns naive datetimes by default which breaks the
    # subtraction against `datetime.now(timezone.utc)`.
    def _as_aware_utc(dt):
        if not isinstance(dt, datetime):
            return None
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    created = _as_aware_utc(doc.get("created_at"))
    completed = _as_aware_utc(doc.get("completed_at") or doc.get("updated_at"))
    now = datetime.now(timezone.utc)
    elapsed_ms = None
    age_seconds = None
    if created is not None:
        ref = completed if completed is not None else now
        elapsed_ms = int((ref - created).total_seconds() * 1000)
        age_seconds = int((now - created).total_seconds())
    return {
        "run": {
            "run_id": doc.get("run_id"),
            "status": doc.get("status"),
            "stage": doc.get("stage"),
            "page_count": doc.get("page_count"),
            # Iter 78z+ — persisted page filenames so the frontend can
            # render them in the ProfileAnnotator on a resume.
            "page_paths": doc.get("page_paths") or "",
            "result": doc.get("result"),
            "error": doc.get("error"),
            "elapsed_ms": elapsed_ms,
            "age_seconds": age_seconds,
        },
    }


async def _execute_ai_blueprint_worker(
    *,
    run_id: str,
    image_payloads: list[bytes],
    api_key: str,
    user_id: str,
    address: Optional[str],
    overhang_in: float,
    estimate_id: Optional[str] = None,
):
    """Background worker — runs the Claude blueprint read, aggregates,
    maps to lines + Vero/Mezzo openings, and writes the final result
    back to the run doc."""
    async def _set_stage(stage: str):
        await db.ai_blueprint_runs.update_one(
            {"run_id": run_id},
            {"$set": {"stage": stage, "updated_at": datetime.now(timezone.utc)}},
        )
    try:
        await _set_stage("claude")
        image_contents = [
            ImageContent(image_base64=base64.b64encode(p).decode("ascii"))
            for p in image_payloads
        ]
        session_id = f"ai-blueprint-{user_id}-{uuid.uuid4().hex[:8]}"
        chat = LlmChat(
            api_key=api_key,
            session_id=session_id,
            system_message=SYSTEM_PROMPT,
        ).with_model("anthropic", MODEL_NAME)

        prompt_parts: list[str] = [
            f"You are receiving {len(image_payloads)} plan sheet(s) as images.",
        ]
        if address:
            prompt_parts.append(f"Project address: {address}")
        prompt_parts.append(
            "Read the printed dimensions on the elevations + floor plan, "
            "and extract the window/door schedule if one is present. "
            "Return the JSON takeoff object now."
        )
        user_text = "\n".join(prompt_parts)
        reply_text = await chat.send_message(
            UserMessage(text=user_text, file_contents=image_contents),
        )

        await _set_stage("aggregating")
        raw = _json_from_reply(reply_text or "")
        # Iter 78z — Load user-drawn profile annotations from the
        # estimate so the breakdown overlay can layer them as
        # authoritative accents.
        annotations: dict | None = None
        if estimate_id:
            est_doc = await db.estimates.find_one(
                {"id": estimate_id},
                {"_id": 0, "profile_annotations": 1},
            )
            if est_doc:
                annotations = est_doc.get("profile_annotations") or None
        measurements = _aggregate_to_hover_shape(raw, annotations=annotations)
        measurements["overhang_in"] = float(overhang_in)

        await _set_stage("mapping")
        try:
            lines = _build_lines(measurements)
        except Exception:
            lines = []
        try:
            vero_openings, mezzo_openings = _build_window_openings(measurements)
        except Exception:
            vero_openings, mezzo_openings = [], []

        result = {
            "measurements": measurements,
            "lines": lines,
            "vero_openings": vero_openings,
            "mezzo_openings": mezzo_openings,
            "raw_ai": raw,
            "model": MODEL_NAME,
            "session_id": session_id,
            "pages_processed": len(image_payloads),
        }
        await db.ai_blueprint_runs.update_one(
            {"run_id": run_id},
            {"$set": {
                "status": "done",
                "stage": "done",
                "result": result,
                "completed_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }},
        )
    except Exception as e:
        logger.exception("[ai-blueprint] worker failed for run_id=%s", run_id)
        await db.ai_blueprint_runs.update_one(
            {"run_id": run_id},
            {"$set": {
                "status": "error",
                "stage": "error",
                "error": f"AI blueprint read failed: {e}",
                "completed_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }},
        )
