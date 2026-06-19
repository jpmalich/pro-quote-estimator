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
# Iter 57b: bumped from 8 → 9 so contractors can add the free Google
# Maps aerial alongside the 8 standard elevation shots from the Guided
# Capture wizard. The aerial is a small ~400 KB tile; total payload
# stays under Claude Opus's 100 MB request limit by a wide margin.
MAX_FILES = 9
MAX_BYTES_PER_FILE = 12 * 1024 * 1024  # 12 MB pre-base64 (Iter 56b: bumped from 8 MB to accommodate modern phone photos + annotated re-renders)
# Iter 49: bumped from claude-sonnet-4-5-20250929 to claude-opus-4-5
# at Howard's request — ~3× cost per measure but materially better at
# distinguishing dormers / gables / 2nd-story walls on residential
# exteriors. The image schema and `_aggregate_to_hover_shape` math
# are unchanged.
MODEL_NAME = "claude-opus-4-5-20251101"


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
  "photos": [
    // ONE entry per photo IN THE EXACT ORDER they were sent to you.
    // photos[0] = the first attached image, photos[1] = the second, etc.
    // Use this to auto-tag elevations (saves the contractor from manually
    // labelling each thumb in the UI).
    {"index": number,                     // 0-based index matching the order the photos were attached
     "elevation": "front" | "front-left" | "left" | "rear-left" | "back" | "rear-right" | "right" | "front-right" | "aerial" | "detail" | "other",
     // 4 cardinals = a centered shot of that wall. 4 corners = a 45° corner
     // shot showing TWO walls. Tag corners as their specific corner name
     // (front-left, rear-left, etc.) so the contractor's photo grid
     // shows distinct badges instead of "FRONT, FRONT, FRONT".
     "elevation_confidence": number,      // 0-100, how confident are you in the elevation tag
     "elevation_reasoning": "<1 short sentence — what told you which side this is>"
    }
  ],
  "walls": [
    {"label": "front" | "back" | "left" | "right" | "other",
     "width_ft": number,
     "height_ft": number,                 // EAVE height ONLY — measure from floor up to the soffit/gutter line. NEVER include the gable triangle, NEVER include a dormer.
     "gable_triangle_height_ft": number,  // 0 if this wall ends in an eave; >0 ONLY if this wall is a gable-end (you can see the triangular peak above the eave). Triangle area is auto-computed as 0.5 × width × this value.
     "dormer_face_sqft": number,          // 0 unless a true dormer (small box poking out of the roof) is on this elevation. Estimate the visible vertical face area in ft² — typically 20-60 ft² each.
     "siding_pct_this_wall": number,      // INTEGER 0-100 (percent), NOT a fraction. Use 85 to mean 85% siding — NEVER 0.85. Siding only, not brick / garage door / etc.
     "confidence": number,                // 0-100, how confident are you in THIS wall's measurements. <50 = barely visible / inferred. 50-79 = visible but obstructed or angled. 80-100 = clear straight-on shot with reference.
     "confidence_reasoning": "<1 short sentence — what reduces or supports confidence on THIS wall>"
    }
  ],
  "openings": [
    {"type": "window" | "entry_door" | "patio_door" | "garage_door" | "vent" | "other",
     "style": "Double Hung" | "Single Hung" | "Casement" | "Twin Casement" | "Awning" | "Hopper" | "2-Lite Slider" | "3-Lite Slider" | "Picture" | "Twin Double Hung" | "Twin Single Hung" | "Triple Double Hung" | "Bay Window" | "Bow Window" | "Half-Round" | "Quarter-Round" | "Arch" | "Octagon" | "Hexagon" | "Garden Window" | "Other Shape" | "",
     "style_confidence": number,         // 0-100 — required when `style` is filled
     "width_in": number, "height_in": number, "wall": "front"|"back"|"left"|"right"|"other"}
  ],
  "openings_schedule": [
    // GROUPED roll-up of `openings` above — collapses duplicate sizes
    // into a single row per (elevation × type × size × style). Lets the
    // contractor verify counts at a glance ("4 × 36×60 Double Hung
    // windows on front" is easier to spot-check than 4 individual entries).
    {"elevation": "front" | "back" | "left" | "right" | "other",
     "type": "window" | "entry_door" | "patio_door" | "garage_door" | "vent" | "other",
     "style": "Double Hung" | "Casement" | "Picture" | etc. | "",  // SAME set as `openings[].style` above
     "width_in": number, "height_in": number,
     "count": number,                     // how many of this size on this elevation
     "size_label": "<e.g. '36\\"×60\\"' or 'Patio 72\\"×80\\"'>"
    }
  ],
  "eaves_lf": number,          // sum of horizontal soffit/gutter run, linear feet
  "rakes_lf": number,          // sum of sloped roof edges, linear feet (= the rake legs of every gable triangle)
  "starter_lf": number,        // linear feet of starter strip at the base of the siding (typically ≈ eaves_lf for a basic 1-story; can differ on porches, walk-outs, or multi-section homes)
  "outside_corner_lf": number, // linear feet of OUTSIDE corner posts visible across all elevations (typically 4 corners × wall height on a simple rectangular house)
  "inside_corner_lf": number,  // linear feet of INSIDE corner posts (L-shaped wing additions, dormers, returns — often 0 for a basic rectangle)
  "missing_elevations": ["front" | "back" | "left" | "right"],  // any elevations NOT visible in any photo
  "double_count_check": "<1 sentence: did you cross-reference openings/walls visible from multiple angles to avoid double-counting? E.g. 'Front-right corner window is the same window seen in photo #2's left view — counted once.'>",
  "notes": "<1-2 sentences flagging anything the contractor should verify>"
}

CRITICAL accuracy rules (read every time):

0a. PRE-AI PHOTO ANNOTATIONS (highest-priority signal):
   The contractor may have marked up some photos BEFORE sending them.
   Look for these visual marks — they are ground truth, NOT guesses:
   • Purple corner badge "FRONT/BACK/LEFT/RIGHT ELEVATION" — this is the
     authoritative elevation tag for that photo. Use it to label the
     `walls[]` entry. If a badge says "FRONT ELEVATION", the wall in
     that photo IS the front wall — do not relabel it as "other".
   • Purple corner badge "AERIAL ELEVATION" — this is a top-down
     satellite view of the property from Esri World Imagery. There is
     a RED CROSSHAIR + RING in the exact center of the image with a
     "TARGET" label — that ring marks the geocoded address. ⚠ The
     geocoder often misses on rural / multi-building lots, so look for
     an OVERRIDE: a GREEN RECTANGLE labeled "TARGET HOUSE". If a green
     "TARGET HOUSE" box is present, IT IS AUTHORITATIVE — ignore the
     red auto-crosshair and measure ONLY the structure INSIDE the green
     box. Other buildings in frame — even adjacent ones 1–2 ft away
     (common in city lots) — are NEIGHBORS, IGNORE them entirely. If
     only the red crosshair is present, use it as your best guess. Any
     other houses visible in the frame are NEIGHBORS — IGNORE them. Use this aerial ONLY to measure the roof
     outline of the targeted structure: `eaves_lf` (total horizontal
     roof edges) and `rakes_lf` (total sloped gable-edge legs). DO NOT
     use it for wall heights, story count, openings, or siding %.
     Those must come from the ground-level elevation photos.
   • Red line with red endpoints + red label like 'REF = 80"' — this is
     a contractor-confirmed scale anchor. The red line spans a real-world
     distance of exactly that many inches in the photo. Use it to lock
     scale for that ENTIRE photo with high confidence. Set
     scale_confidence to "high" and reference_used to "contractor red-line ref".
   • Colored hatched zones with a black label like "NO SIDING · Brick"
     or "NO SIDING · Stone" or "NO SIDING · Garage door" — these areas
     are NOT clad in siding. They must be EXCLUDED from
     siding_pct_this_wall calculations for the wall they appear on.
     Example: a wall is 32×9 = 288 ft² gross, with a "NO SIDING · Brick"
     hatched zone covering the lower 3 ft (≈96 ft²) → the remaining
     siding is 192 ft² → siding_pct_this_wall = round(192 / 288 * 100) = 67.
   Trust the annotations OVER your own visual judgment of the same photo.
   If a photo has a red ref line you must use it; if it has a NO SIDING
   zone you must subtract it. These were placed deliberately by the
   contractor — they know the house.

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

4. DORMERS (REQUIRED — SCAN EVERY ROOFLINE):
   BEFORE finalizing each elevation, trace the roofline in the photo
   from end to end looking for projections breaking the smooth slope.
   Common dormer signatures (look for ALL of these, not just one):
     • Small box-shaped projection out of the roof slope with its own
       mini-roof (gable, shed, or eyebrow shape)
     • One or two windows set INTO the roof slope (not on the main
       wall plane) — the window is recessed behind a visible roof slope
       on either side
     • A horizontal eave line ABOVE the main eave at a noticeably
       smaller width than the wall below
     • Shed dormers run wide and low (common on 1.5-story Capes / capes)
     • Gable dormers are narrow and triangular-topped
     • Eyebrow dormers are curved/arched and very subtle
   For EACH dormer found, estimate `dormer_face_sqft` (typical residential
   range: 20-60 ft² per dormer face — a 4 ft wide × 4 ft tall gable dormer
   = 16 ft²; a 12 ft wide × 6 ft tall shed dormer = 72 ft²) and record
   the total sum on the wall it FACES (front / back / left / right).
   Do NOT add dormer height to `height_ft` — that breaks the gable math.
   If a wall has 2 dormers, sum their face areas into one `dormer_face_sqft`
   value on that wall. If you see dormers ANYWHERE in any photo, you
   MUST record them — missing dormers is a top-3 source of under-quoting.
   In `notes`, briefly call out each dormer you found: e.g. "Shed dormer
   on left elevation, ~12 ft × 6 ft = 72 ft² face; gable dormer on right,
   ~4 ft × 4 ft = 16 ft² face."

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

10. SATELLITE FUSION — when an "aerial" elevation photo is present (look
   for the "AERIAL ELEVATION" purple badge), TREAT THE AERIAL AS THE
   AUTHORITATIVE SOURCE for roof-outline measurements:
   • `eaves_lf` (total horizontal roof edges) — read from the aerial's
     top-down view of the soffit line. Far more accurate than inferring
     from oblique ground photos.
   • `rakes_lf` (sloped gable-edge legs) — read from the aerial's roof
     ridge → eave segments at gable ends.
   • House footprint width × depth — anchor these with the aerial.
   The ground-level photos still drive `height_ft`, `gable_triangle_height_ft`,
   `dormer_face_sqft`, openings, story count, and siding coverage —
   things you cannot see from above. Don't try to read wall heights or
   window counts off the aerial.

11. DOUBLE-COUNT CHECK (REQUIRED — DEDUPE BEFORE RETURNING):
   When the same window/door/wall corner is visible from two angles
   (very common: a front-elevation photo AND a corner photo both show
   the same front-right window), you MUST count it EXACTLY ONCE.
   Process for every opening:
     • Group openings by (wall, type, approximate size). If you see a
       36"×60" window on the front-right of the front-elevation photo,
       AND a 36"×60" window on the left edge of the front-right corner
       photo, they are THE SAME WINDOW. Emit ONE entry in `openings[]`,
       not two.
     • Outside corner posts at any rectangular-house corner appear in
       two photos. Count each unique corner ONCE in `outside_corner_lf`.
     • The front wall visible in both the front-elevation photo and a
       front-corner photo is the SAME wall. One row in `walls[]`, not two.
   In `double_count_check`, explicitly list which openings/walls you
   deduplicated and which photos showed them. Example:
   "Front wall has 4 windows (36×60) — visible in photo #1 (front
   elevation) and partially in photo #2 (front-right corner). Counted
   the rightmost window ONCE not twice. Outside corners: 4 total
   (front-left, front-right, back-left, back-right) — each visible
   in two photos but counted once."
   If you cannot tell whether two photos show the same opening or
   different openings, BIAS TO DEDUPE (count once) and flag uncertainty
   in `notes`. Over-counting inflates quotes and erodes contractor trust.

12. PER-WALL CONFIDENCE (required) — emit a `confidence` (0-100) on each
   wall reflecting how well you can actually measure THAT specific wall:
   • 85-100: clear, straight-on photo with a reference object (door,
     brick course, contractor red ref line). Minimal perspective skew.
   • 60-84: visible but at an angle, or partial obstruction (tree, fence,
     vehicle), or no reference object.
   • 30-59: heavily obstructed, deep perspective, or inferred from an
     adjacent photo.
   • 0-29: not visible — measurement is a guess from the opposite side
     or symmetry assumption. Surface these clearly in `notes`.
   Briefly justify in `confidence_reasoning`. The frontend paints a
   colored chip per wall so the contractor knows which to verify in the
   field — be honest, do not inflate.

13. PHOTOS ARRAY — emit ONE entry in `photos[]` PER attached image, in
   the exact attachment order (photos[0] = first image you saw,
   photos[1] = second, ...). For each, infer the elevation so the
   frontend can auto-tag thumbnails. Use one of these 11 values:
     • front / back / left / right — centered shot of ONE wall
     • front-left / rear-left / rear-right / front-right — 45° CORNER
       shot showing TWO walls. Pick the corner whose two walls are
       both visible in the frame. A photo taken from the SE corner
       looking NW shows front + right → "front-right".
     • aerial — top-down satellite/drone
     • detail — close-up of a single feature (window, dormer, corner
       post). Use this for the "Scale ✓" reference shot.
     • other — none of the above (rare).
   The purple "ELEVATION" annotation badge — when present —
   is always authoritative; otherwise lean on entry-door cues (front),
   driveway+garage (front or side), backyard cues (back), and footprint
   geometry. `elevation_confidence` 0-100 mirrors your certainty.
   Tag corner shots as their corner (not as one of the two walls) so
   the contractor sees distinct badges in the photo grid.

14. WINDOW STYLE / OPERATION (REQUIRED — emit `style` on EVERY window opening):
   For each `openings[]` row of type=window AND each `openings_schedule[]`
   window row, identify the operation style. Use these visual signatures:
     • **Double Hung** — single window with a HORIZONTAL meeting rail
       cutting the glass in half (top sash + bottom sash). The most
       common residential style by far. Width-to-height ratio is usually
       0.5-0.8 (taller than wide).
     • **Single Hung** — looks identical to double hung from afar (one
       meeting rail). If you cannot tell DH vs SH from a photo, pick
       Double Hung and note uncertainty in `style_confidence` (50-65).
     • **Casement** — single pane of glass with NO meeting rail. Hinged
       on the side, opens with a crank. Crank handle (small lever at the
       bottom or side) visible when present. Often narrow and tall.
     • **Twin Casement** — TWO casements side-by-side sharing a mullion,
       each with its own crank. Common in kitchens.
     • **2-Lite Slider (XO)** — TWO panes of equal size side-by-side
       with a VERTICAL meeting bar. Usually wider than tall. One side
       slides horizontally.
     • **3-Lite Slider (XOX)** — THREE panes side-by-side, fixed +
       sliding + fixed. Very wide landscape orientation.
     • **Picture / Fixed** — single large pane of glass with NO meeting
       rails, NO crank, NO operable hardware. Often square or nearly
       square. Used as a focal window over a sink, fireplace, etc.
     • **Twin Double Hung** — TWO double hungs side-by-side sharing a
       mullion. Each half has its own horizontal meeting rail. Common
       on master bedroom walls.
     • **Triple Double Hung** — three double hungs in a row, often
       above a kitchen sink.
     • **Awning** — horizontal hinge on TOP, opens outward at the
       bottom. Usually WIDE landscape and small (used above doors or
       as transoms).
     • **Hopper** — horizontal hinge on BOTTOM, opens inward at the
       top. Common in basements. Small landscape.
     • **Bay Window** — 3-section bump-out projecting from the wall;
       center is picture, sides are double hung or casement.
     • **Bow Window** — 4-5 section curved bump-out projecting from
       the wall. Smoother arc than a bay.
     • **Half-Round** — semicircle window. Often a transom above a
       picture window or entry door.
     • **Quarter-Round** — quarter circle / pie-slice shape.
     • **Arch** — rectangle with a curved/arched top edge.
     • **Octagon** — 8-sided window. Common as accent in gables.
     • **Hexagon** — 6-sided window.
     • **Garden Window** — small box-shaped bump-out, usually over a
       kitchen sink. Glass on three sides + top.
     • **Other Shape** — specialty/custom that doesn't fit above. Note
       in `notes`.
   Emit `style_confidence` 0-100 reflecting how certain you are:
     • 85-100 — clear view with operating hardware visible (crank,
       meeting rail clearly visible, etc.).
     • 60-84 — visible but oblique or partly obstructed.
     • 30-59 — heavily inferred (e.g. "looks like DH but could be SH").
     • 0-29 — guess. The frontend lets the contractor correct any
       guess with a dropdown — be honest, not overconfident.
   If you genuinely cannot tell the style from the photo (window
   covered by curtains/shutters, deep shadow, etc.), emit "" and
   `style_confidence: 0` so the frontend flags it as needing manual
   selection. Do NOT default everything to Double Hung — under-
   identifying Casement / Picture / Slider causes downstream pricing
   errors of $300-$1200 per opening.
   For entry_door / patio_door / garage_door / vent / other,
   emit `style: ""` and `style_confidence: 0` — style only applies
   to windows.

Return ONLY the JSON object. No explanation, no code fences."""

# Iter 57d — Window style → Vero product_type mapper. Vero only ships 5
# product_types, but the AI's `style` vocabulary is much richer (so the
# customer PDF can say "Twin Double Hung windows 36"×60"" while the
# Vero quote rows fall into one of the 5 buckets). For multi-unit styles
# (Twin DH / Twin Casement / Bay / Bow), the qty is multiplied so a
# single openings row becomes the correct count of Vero opening rows.
_STYLE_TO_VERO_PRODUCT_TYPE: dict[str, tuple[str, int]] = {
    "Double Hung":        ("Vero Double Hung",     1),
    "Single Hung":        ("Vero Double Hung",     1),
    "Casement":           ("Vero 1-Lite Casement", 1),
    "Twin Casement":      ("Vero 1-Lite Casement", 2),
    "Awning":             ("Vero 1-Lite Casement", 1),
    "Hopper":             ("Vero 1-Lite Casement", 1),
    "2-Lite Slider":      ("Vero 2-Lite Slider",   1),
    "3-Lite Slider":      ("Vero 3-Lite Slider",   1),
    "Picture":            ("Vero Picture",         1),
    "Twin Double Hung":   ("Vero Double Hung",     2),
    "Twin Single Hung":   ("Vero Double Hung",     2),
    "Triple Double Hung": ("Vero Double Hung",     3),
    "Bay Window":         ("Vero Picture",         3),
    "Bow Window":         ("Vero Picture",         5),
    "Half-Round":         ("Vero Picture",         1),
    "Quarter-Round":      ("Vero Picture",         1),
    "Arch":               ("Vero Picture",         1),
    "Octagon":            ("Vero Picture",         1),
    "Hexagon":            ("Vero Picture",         1),
    "Garden Window":      ("Vero Picture",         1),
    "Other Shape":        ("Vero Picture",         1),
}


def _vero_for_style(style: str, width_in: float, height_in: float) -> tuple[str, int]:
    """Map an AI `style` string to (Vero product_type, qty_multiplier).
    Falls back to the legacy W/H heuristic from hover.py when the style
    is empty/unknown — preserves backwards-compatible behaviour for
    legacy sessions that have no style field."""
    style = (style or "").strip()
    if style in _STYLE_TO_VERO_PRODUCT_TYPE:
        return _STYLE_TO_VERO_PRODUCT_TYPE[style]
    from .hover import _guess_vero_product_type  # local import avoids cycle
    return (_guess_vero_product_type(width_in, height_in), 1)


def _build_vero_openings_from_ai(openings: list) -> list[dict]:
    """Turn AI-detected `openings[]` (windows only) into the
    `vero_openings[]` rows the Windows workspace expects on Apply.
    Each opening becomes 1+ Vero rows depending on its multi-unit style
    (e.g. Twin Double Hung → 2 rows of Vero Double Hung).
    Non-window openings (doors / vents) are skipped — they belong to
    the Siding workspace's accessory rows, not Windows."""
    out: list[dict] = []
    for o in openings or []:
        otype = (o.get("type") or "").lower()
        if otype != "window":
            continue
        try:
            w = float(o.get("width_in") or 0)
            h = float(o.get("height_in") or 0)
        except (TypeError, ValueError):
            continue
        if w <= 0 or h <= 0:
            continue
        style = (o.get("style") or "").strip()
        product_type, qty_mult = _vero_for_style(style, w, h)
        wall = (o.get("wall") or "other").lower()
        label = f"AI · {wall} · {style or 'Window'} · {int(w)}×{int(h)}"
        for _ in range(max(1, qty_mult)):
            out.append({
                "id": str(uuid.uuid4()),
                "hover_id": "",
                "product_type": product_type,
                "label": label,
                "width": w,
                "height": h,
                "qty": 1,
                "sister_color": "White Interior/White Exterior",
                "sizing": "ui_bucket",
                "bucket_label": "",
                "base_mat": 0,
                "adders": [],
                # Keep the rich style for the customer PDF (spelled out)
                "ai_style": style,
            })
    return out




def _dedupe_openings(openings: list) -> list:
    """Iter 57b safety net — collapse near-duplicate openings that Claude
    occasionally double-counts when the same window appears in two photos
    (front + corner). Group by (wall, type, width_in rounded to nearest 6
    in, height_in rounded to nearest 6 in). Within a group, keep the
    SINGLE highest-count representative — never sum, never duplicate.

    The bin width of 6 inches covers normal photo-perspective error
    (a 36" window viewed at an angle might be measured as 32" or 38")
    without merging genuinely different sizes (a 24" bathroom window
    vs a 36" bedroom window stay separate at bin width 6 in).

    Returns a fresh list — input is not mutated."""
    if not openings:
        return openings
    seen: dict[tuple, dict] = {}
    for o in openings:
        try:
            w = float(o.get("width_in") or 0)
            h = float(o.get("height_in") or 0)
        except (TypeError, ValueError):
            continue
        if w <= 0 or h <= 0:
            continue
        wall = (o.get("wall") or "other").lower()
        otype = (o.get("type") or "other").lower()
        # Bin width 6 in — matches the bin used in openings_schedule
        # roll-up so a contractor can spot-check counts there too.
        # Iter 57d — also key on `style` so two same-size windows of
        # DIFFERENT operation styles (e.g. a Picture + a Casement, both
        # 36×36 on the same wall) are NOT merged. Style mismatch is a
        # genuinely different opening even at identical W×H.
        style = (o.get("style") or "").strip().lower()
        key = (wall, otype, round(w / 6) * 6, round(h / 6) * 6, style)
        # First occurrence wins. We DO NOT sum — Claude already returned
        # one entry per visible window, and our job here is to undo any
        # cross-photo double-count.
        if key not in seen:
            seen[key] = dict(o)
    return list(seen.values())


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
    # Iter 57b — dedupe openings as a safety net. Even with the
    # strengthened double-count prompt rule, Opus occasionally returns
    # the same window twice when it appears at the edges of two photos.
    raw_openings = raw.get("openings") or []
    openings = _dedupe_openings(raw_openings)
    deduped_count = len(raw_openings) - len(openings)
    if deduped_count > 0:
        # Stash the pre-dedupe list back onto raw so the frontend's
        # raw_ai display matches what the aggregator actually counted,
        # AND surface the dedup tally in notes so the contractor knows
        # the safety net fired.
        raw["openings_raw_before_dedupe"] = list(raw_openings)
        raw["openings"] = openings
        prev_notes = raw.get("notes") or ""
        raw["notes"] = (
            f"Backend deduped {deduped_count} double-counted opening"
            f"{'s' if deduped_count > 1 else ''} (same window seen from two angles). "
            + prev_notes
        ).strip()

    siding_sqft = 0.0
    gable_sqft = 0.0
    dormer_sqft = 0.0
    for w in walls:
        width_ft = float(w.get("width_ft") or 0)
        eave_h = float(w.get("height_ft") or 0)
        # Iter 55: HARD CLAMP — Claude occasionally returns wall heights
        # as story-units (1.0 = 1 story) or stupidly small fractions
        # (0.7 ft) which deflates the whole quote by 10–100×. No real
        # exterior wall is < 7 ft. If we get something nonsensical, fall
        # back to the global avg_wall_height_ft, then the story-default.
        if 0 < eave_h < 7:
            avg = float(raw.get("avg_wall_height_ft") or 0)
            story = float(raw.get("story_count") or 1)
            if avg >= 7:
                eave_h = avg
            elif story >= 2:
                eave_h = 18.0
            elif story >= 1.5:
                eave_h = 12.0
            else:
                eave_h = 9.0
        # Same defensive clamp for width — no real house wall is < 5 ft.
        # Single-digit widths usually mean Claude returned a meaningless
        # fraction. Skip the wall (don't try to guess a width).
        if 0 < width_ft < 5:
            width_ft = 0
        gross = width_ft * eave_h
        pct = float(w.get("siding_pct_this_wall") or 100.0)
        # Defensive parsing: Claude sometimes returns 0.85 meaning "85%"
        # (a fraction) and sometimes returns 85 meaning "85%". Without
        # this clamp a 2000 ft² house can shrink to 17 ft² because 0.85
        # gets read as 0.85%. Heuristic: anything strictly between 0 and
        # 1 is a fraction — multiply by 100 to get a percent. Anything
        # exactly 0 or above 1 is already a percent (or junk).
        if 0 < pct < 1:
            pct = pct * 100.0
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
        # Iter 57: HOVER-like extras — per-wall confidence chips, an
        # openings schedule grouped by elevation/size, double-count
        # check note, missing-elevations flag, and per-photo elevation
        # auto-tags. All optional in the raw_ai payload so older
        # responses degrade gracefully.
        "_ai_missing_elevations": raw.get("missing_elevations") or [],
        "_ai_double_count_check": raw.get("double_count_check") or "",
        "_ai_openings_schedule": raw.get("openings_schedule") or [],
        "_ai_photos": raw.get("photos") or [],
        "_ai_notes": raw.get("notes") or "",
    }
    return measurements


@router.post("/ai-measure")
async def ai_measure(
    files: list[UploadFile] = File(default=[]),
    photo_paths: Optional[str] = Form(None),
    reference_dim: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    kind: str = Form("siding"),
    overhang_in: float = Form(12.0),
    user: dict = Depends(get_current_user),
):
    """Run an AI photo-measure pass on 2-8 uploaded photos.

    `overhang_in` (inches) flows into the soffit piece-count formula so
    the imported qty matches the estimate's current Overhang setting.

    Photos can be passed two ways:
      • Legacy: `files` multipart upload (one per photo).
      • Session-friendly: `photo_paths` — a comma-separated list of
        filenames already uploaded via /api/uploads (lives in UPLOAD_DIR).
        This is how the resumable AI Measure session avoids re-uploading.
    """
    # Resolve raw image bytes from either source.
    image_payloads: list[tuple[str, bytes]] = []  # [(content_type, raw_bytes)]
    if photo_paths:
        from config import UPLOAD_DIR  # local import to avoid top-level cycle
        for name in [p.strip() for p in photo_paths.split(",") if p.strip()]:
            target = UPLOAD_DIR / name
            if not target.exists():
                raise HTTPException(
                    status_code=404,
                    detail=f"Uploaded photo {name!r} not found on server",
                )
            data = target.read_bytes()
            ext = name.rsplit(".", 1)[-1].lower()
            ctype = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")
            image_payloads.append((ctype, data))
    if files:
        for f in files:
            ctype = (f.content_type or "").lower()
            if ctype not in ACCEPTED_MIMES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type {ctype!r} — use JPG, PNG, or WEBP",
                )
            raw = await f.read()
            if len(raw) == 0:
                continue
            image_payloads.append((ctype, raw))

    if not image_payloads:
        raise HTTPException(status_code=400, detail="At least one photo is required")
    if len(image_payloads) > MAX_FILES:
        raise HTTPException(
            status_code=400, detail=f"Maximum {MAX_FILES} photos per request",
        )

    image_contents = []
    for ctype, raw in image_payloads:
        if len(raw) > MAX_BYTES_PER_FILE:
            raise HTTPException(
                status_code=413,
                detail="Photo exceeds 12 MB limit",
            )
        image_contents.append(ImageContent(image_base64=base64.b64encode(raw).decode("ascii")))

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

    prompt_parts = []
    # Iter 54: the previous prompt leaked the workspace key ("iss") to
    # Claude as `Workspace: iss estimate.` which made Opus return
    # comically tiny wall dimensions on ISS jobs (Charter Oak came out
    # 0.2 SQ on a 25 SQ house). The measurements should be identical
    # regardless of which workspace the contractor is in — they always
    # describe the same physical house. So we no longer mention the
    # workspace; the same Python aggregator drives every flow.
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
        # Iter 57d — AI photo measure now populates vero_openings using
        # the per-window `style` field. Each AI-detected window becomes
        # 1+ Vero rows (Twin DH → 2 rows of Vero Double Hung, etc.).
        # On Apply, the Windows workspace gets pre-seeded with the
        # right product types instead of being empty.
        "vero_openings": _build_vero_openings_from_ai(raw.get("openings") or []),
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
