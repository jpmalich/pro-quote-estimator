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

import asyncio
import base64
import io
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from emergentintegrations.llm.chat import (
    ImageContent,
    LlmChat,
    UserMessage,
)
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image

from deps import get_current_user
from db import db
from routes.hover import _build_lines  # reuse the same measurement→line mapper

logger = logging.getLogger(__name__)

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


def _compress_for_claude(img_bytes: bytes, max_raw_bytes: int = 5_500_000) -> bytes:
    """Ensure a single image fits under Anthropic's 10 MB base64 cap.
    Anthropic measures the base64-encoded payload (~1.33× raw), so
    targeting raw bytes < ~5.5 MB keeps base64 < ~7.3 MB with headroom.

    Strategy: JPEG-encode at q=88; if still too large iteratively
    downscale by 0.85× and drop quality. Falls back to original on
    PIL failure. Skips small JPEGs untouched.
    """
    if len(img_bytes) <= max_raw_bytes and img_bytes[:3] == b"\xff\xd8\xff":
        return img_bytes
    try:
        with Image.open(io.BytesIO(img_bytes)) as im:
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            qualities = [88, 85, 78, 70, 60]
            scales = [1.0, 0.85, 0.72, 0.6, 0.5, 0.42]
            data = img_bytes
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
            return data
    except Exception:
        logger.exception("[ai-measure] image compression failed; sending original")
        return img_bytes


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
     // Iter 78z — Profile callouts per elevation. Capture the raw text or
     // visible siding pattern so the catalog mapper can split LAP / SHAKE /
     // B&B / DUTCH LAP into SEPARATE quote lines. Without these, mixed
     // material houses (lap on body + shake on gable + B&B on dormer)
     // collapse into a single inflated lap number. Howard's Campbell
     // house had all 3 profiles and we missed shake + B&B entirely.
     "wall_body_profile_callout": "<raw text from photo IF visible (e.g. 'LAP 4\"', 'DUTCH LAP', 'VINYL'); OR the pattern you can see ('horizontal lap', 'dutch lap', 'board and batten', 'shake', 'nickel gap', 'vertical'); OR empty if you can't tell>",
     "gable_profile_callout": "<MANDATORY when gable_triangle_height_ft > 0. CRITICAL: gables OFTEN carry a DIFFERENT profile than the wall body — most commonly SHAKE (cedar shake / scallop / fishscale) or BOARD AND BATTEN (vertical battens) for visual accent. Even when the gable LOOKS like it might match the body, look CAREFULLY for: scalloped bottom edges, vertical seams between panels, staggered courses, decorative cuts. If you see ANY visual difference from the body, call it out — 'shake', 'board and batten', 'vertical', 'fishscale', etc. ONLY leave empty if you can clearly see the EXACT same horizontal lap pattern continuing into the triangle without interruption.>",
     "dormer_profile_callout": "<MANDATORY when dormer_face_sqft > 0. Same logic as gable_profile_callout — dormers commonly carry SHAKE / BOARD AND BATTEN as an accent. Look for vertical battens, scalloped edges, or staggered cedar courses. Only leave empty when the dormer clearly continues the body's exact horizontal lap.>",
     // Iter 78z+ — ACCENT PANELS. A single wall can carry SMALL accent
     // areas with a different profile from the body — easy to miss
     // because they don't fit the "body / gable / dormer" buckets.
     // Examples seen on Howard's jobs: B&B on a porch face, shake on
     // column wraps, vertical siding on a bay-window cheek, fish-scale
     // on an entry gable above the porch. Capture every accent you
     // can see on THIS wall in the photo. Leave [] if uniform.
     "accent_profiles": [
       {"location": "<short description, e.g. 'porch face', 'column wrap', 'bay window cheek', 'entry gable', 'kneewall'>",
        "profile_callout": "<raw text or visible pattern (e.g. 'B&B', 'BOARD AND BATTEN', 'SHAKE', 'VERTICAL')>",
        "approx_sqft": number}
     ],
     "confidence": number,                // 0-100, how confident are you in THIS wall's measurements. <50 = barely visible / inferred. 50-79 = visible but obstructed or angled. 80-100 = clear straight-on shot with reference.
     "confidence_reasoning": "<1 short sentence — what reduces or supports confidence on THIS wall>"
    }
  ],
  "openings": [
    {"type": "window" | "entry_door" | "patio_door" | "garage_door" | "vent" | "other",
     "style": "Double Hung" | "Single Hung" | "Casement" | "Twin Casement" | "Awning" | "Hopper" | "2-Lite Slider" | "3-Lite Slider" | "Picture" | "Twin Double Hung" | "Twin Single Hung" | "Triple Double Hung" | "Bay Window" | "Bow Window" | "Half-Round" | "Quarter-Round" | "Arch" | "Octagon" | "Hexagon" | "Garden Window" | "Other Shape" | "",
     "style_confidence": number,         // 0-100 — required when `style` is filled
     "width_in": number, "height_in": number, "wall": "front"|"back"|"left"|"right"|"other",
     // Iter 57n — per-opening photo location. Helps us draw labeled
     // arrows on the photo AND place each opening at its TRUE
     // x-position on the 2D wall diagram instead of guessing.
     "photo_idx": number,                // 0-based index of the photo this opening is visible in (matching the order you were given). If you can't pinpoint, omit.
     "bbox": {"x": number, "y": number, "w": number, "h": number}  // normalized 0.0–1.0 bounding box of the opening on photo_idx. Origin top-left. Omit if you're not confident enough to draw the box.
    }
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
     "size_label": "<e.g. '36\\"×60\\"' or 'Patio 72\\"×80\\"'>",
     // Iter 57n — array of {photo_idx, bbox} entries — ONE per
     // physical opening in this row. Length must equal `count` when
     // you're confident. Omit individual entries you can't pinpoint.
     "locations": [{"photo_idx": number, "bbox": {"x": number, "y": number, "w": number, "h": number}}]
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
   The user may have added overlays to the photos BEFORE you saw them.
   When present, treat them as AUTHORITATIVE — they override anything
   you'd otherwise infer from pixels:

   • PURPLE "ELEVATION" badge top-left → photo is that exact wall
   • RED line + "WALL REF = N in" → known scale for whole-wall geometry; anchor wall measurements to it
   • BLUE line + "WIN REF = N in" → known scale specifically across a window edge (Iter 57k); use it as a TIGHTER per-window calibration for ALL window measurements on that photo. Whole-wall measurements still anchor to the wall ref; openings (windows, doors) should be sized using the blue WIN REF when it's present (±5% accuracy instead of ±15%).
   • GREEN "TARGET HOUSE" rectangle → measure only what's inside it (aerial)
   • RED hatched zone marked "NO SIDING" → exclude that area from siding %
   • YELLOW circle pin + brown badge with a style abbreviation
     ("DH", "CA", "PIC", "BAY", etc.) → CONTRACTOR-TAGGED WINDOW STYLE.
     Each yellow pin marks ONE window. The brown badge tells you the
     EXACT style (decoded: DH=Double Hung, SH=Single Hung, CA=Casement,
     2CA=Twin Casement, AW=Awning, HP=Hopper, 2SL=2-Lite Slider,
     3SL=3-Lite Slider, PIC=Picture, 2DH=Twin Double Hung, 2SH=Twin
     Single Hung, 3DH=Triple Double Hung, BAY=Bay Window, BOW=Bow
     Window, 1/2=Half-Round, 1/4=Quarter-Round, ARC=Arch, OCT=Octagon,
     HEX=Hexagon, GDN=Garden Window, OTH=Other Shape). Use the tagged
     STYLE as ground truth (style_confidence=100). YOU still measure
     width_in and height_in from the photo using your scale reference
     — the contractor is locking only the operation style, not the
     size. Add untagged windows you also see (with normal confidence).
     Never demote a tagged window's style — contractor's eyes beat
     a JPEG.


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
   • EAVES vs RAKES — IMPORTANT (Iter 57p): the "eave" is the
     HORIZONTAL roof edge running parallel to the ground (where the
     gutter hangs). The "rake" is the SLOPED roof edge climbing the
     side of a gable. ONLY set `eaves_lf > 0` when you can DIRECTLY
     observe a horizontal roof edge in the supplied photos (either
     from an aerial, OR from a ground photo that frames the soffit
     line). If every ground photo shows only the gable-end view (you
     see rakes but no horizontal eave line), set `eaves_lf = 0` and
     add "eaves not visible — verify in field" to `notes`. DO NOT
     infer/guess eave length from front-wall width when no eave is
     observed — that would falsely produce gutter line items on a
     side-elevation-only quote.
   • Red line with red endpoints + red label like 'WALL REF = 80"' — this is
     a contractor-confirmed WALL scale anchor. The red line spans a real-world
     distance of exactly that many inches in the photo. Use it to lock
     scale for whole-wall geometry (widths, heights, eave-to-ground) on
     that ENTIRE photo with high confidence. Set
     scale_confidence to "high" and reference_used to "contractor red-line ref".
   • Blue line with blue endpoints + blue label like 'WIN REF = 36"' — this
     is a contractor-confirmed WINDOW scale anchor (Iter 57k). The blue
     line spans a real-world window edge of exactly that many inches.
     When present, use it as the AUTHORITATIVE scale for ALL window/door
     measurements on that photo (width_in, height_in of every opening).
     Window sizes anchored to the blue WIN REF should land within ±5% of
     real values — far tighter than estimating from the red wall ref.
     The wall ref still governs the rest of the geometry; the two refs
     are complementary, not exclusive.
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

5b. SIDING PROFILE PER ELEVATION (Iter 78z — REQUIRED):
   Even on a single house, different SURFACES often use different
   siding profiles. Almost always seen:
     • Body of the wall = horizontal LAP or DUTCH LAP (most common)
     • Gable triangles  = SHAKE / SHAKER / scallop accent
     • Dormer faces     = SHAKE or BOARD & BATTEN accent
     • SMALL ACCENT AREAS = B&B / shake / vertical on porch faces,
       column wraps, bay-window cheeks, kneewalls, entry-roof gables.
       These are the EASIEST to miss and the #1 cause of an under-quote
       on Howard's mixed-material houses. Always look for vertical
       texture or "different from the rest of the wall" areas.
   Capture four separate callouts per wall:
     - `wall_body_profile_callout`  → the main wall body's profile
     - `gable_profile_callout`      → only when gable_triangle_height_ft > 0
     - `dormer_profile_callout`     → only when dormer_face_sqft > 0
     - `accent_profiles[]`          → small accent zones (B&B porch face,
                                       shake column wrap, vertical bay
                                       cheek, etc.). Estimate ft² each.
   What to look for:
     (a) Text labels visible IN the photo. Architects on construction
         drawings write things like "LAP 4\"", "DUTCH LAP 5\"", "SHAKER",
         "SHAKE", "B&B", "BOARD AND BATTEN", "VERTICAL", "NICKEL GAP",
         "VINYL". Use the literal text when visible.
     (b) The visible pattern in the photo. Even without text labels,
         the look of the surface tells you the profile:
           - Tight horizontal lines, ~4-5\" apart = LAP
           - Same but with a "step" notch in each lap = DUTCH LAP
           - Irregular textured slats stacked vertically with visible
             gaps = SHAKE / SHAKER (cedar-shake look)
           - Wide vertical boards with thin batten strips on top =
             BOARD & BATTEN (a.k.a. B&B / vertical siding)
           - Smooth wide vertical boards with tight V-grooves between
             them = NICKEL GAP
   Output the most specific callout you can. If the wall body and the
   gable look identical, set `gable_profile_callout = ""` and the
   downstream code will inherit from the body. Leaving these empty is
   fine — but a WRONG profile is worse than an empty one (the catalog
   mapper will split the line by profile and produce wrong SKUs).
   For `accent_profiles`, err on the side of including small accents
   even when unsure — under-counting B&B is the most expensive
   mistake we've seen on real jobs.

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
#
# Iter 57t — Vero pricing freeze. Styles that historically routed to
# `Vero Picture` or `Vero 3-Lite Slider` (both frozen) now reroute to
# `Vero Double Hung` so the estimator can hand-tag/upgrade them after
# the fact, instead of landing in a hidden section.
_STYLE_TO_VERO_PRODUCT_TYPE: dict[str, tuple[str, int]] = {
    "Double Hung":        ("Vero Double Hung",     1),
    "Single Hung":        ("Vero Double Hung",     1),
    "Casement":           ("Vero 1-Lite Casement", 1),
    "Twin Casement":      ("Vero 1-Lite Casement", 2),
    "Awning":             ("Vero 1-Lite Casement", 1),
    "Hopper":             ("Vero 1-Lite Casement", 1),
    "2-Lite Slider":      ("Vero 2-Lite Slider",   1),
    "3-Lite Slider":      ("Vero 2-Lite Slider",   1),  # frozen → reroute to 2-Lite
    "Picture":            ("Vero Double Hung",     1),  # frozen → DH
    "Twin Double Hung":   ("Vero Double Hung",     2),
    "Twin Single Hung":   ("Vero Double Hung",     2),
    "Triple Double Hung": ("Vero Double Hung",     3),
    "Bay Window":         ("Vero Double Hung",     3),  # frozen → DH (3-pane)
    "Bow Window":         ("Vero Double Hung",     5),  # frozen → DH (5-pane)
    "Half-Round":         ("Vero Double Hung",     1),  # frozen → DH
    "Quarter-Round":      ("Vero Double Hung",     1),  # frozen → DH
    "Arch":               ("Vero Double Hung",     1),  # frozen → DH
    "Octagon":            ("Vero Double Hung",     1),  # frozen → DH
    "Hexagon":            ("Vero Double Hung",     1),  # frozen → DH
    "Garden Window":      ("Vero Double Hung",     1),  # frozen → DH
    "Other Shape":        ("Vero Double Hung",     1),  # frozen → DH
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


def _build_vero_openings_from_ai(openings: list, schedule: list | None = None) -> list[dict]:
    """Turn AI-detected windows into the `vero_openings[]` rows the
    Windows workspace expects on Apply.

    Iter 57i — primary source is `openings_schedule` (one row per
    (wall, type, size, style) with `count: N`). Each schedule row
    becomes `count × qty_multiplier` Vero rows. Falls back to the
    deduped `openings[]` list when no schedule is present (legacy
    sessions). The schedule path is correct when a wall has 3 distinct
    identical DH windows — they appear as one schedule row with
    count=3 and produce 3 Vero DH rows. The fallback path would
    produce only 1 (under-count).

    Non-window openings (doors / vents) are skipped — they belong to
    the Siding workspace's accessory rows, not Windows."""
    out: list[dict] = []
    seen: set[str] = set()

    def _emit(*, otype: str, w: float, h: float, wall: str, style: str, count: int = 1):
        if otype != "window" or w <= 0 or h <= 0 or count <= 0:
            return
        product_type, qty_mult = _vero_for_style(style, w, h)
        # `qty_mult` covers multi-unit styles (Twin DH=2, Bay=3, Bow=5);
        # `count` covers physically-distinct identical windows.
        total = count * qty_mult
        label = f"AI · {wall} · {style or 'Window'} · {int(w)}×{int(h)}"
        for _ in range(total):
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
                "ai_style": style,
            })

    if schedule:
        for o in schedule:
            try:
                w = float(o.get("width_in") or 0)
                h = float(o.get("height_in") or 0)
            except (TypeError, ValueError):
                continue
            otype = (o.get("type") or "").lower()
            wall = (o.get("elevation") or o.get("wall") or "other").lower()
            style = (o.get("style") or "").strip()
            count = int(o.get("count") or 0)
            seen.add(f"{wall}|{otype}|{int(w)}|{int(h)}|{style.lower()}")
            _emit(otype=otype, w=w, h=h, wall=wall, style=style, count=count)
        return out

    # Legacy fallback — no schedule available, walk the deduped list.
    for o in openings or []:
        try:
            w = float(o.get("width_in") or 0)
            h = float(o.get("height_in") or 0)
        except (TypeError, ValueError):
            continue
        otype = (o.get("type") or "").lower()
        wall = (o.get("wall") or "other").lower()
        style = (o.get("style") or "").strip()
        _emit(otype=otype, w=w, h=h, wall=wall, style=style, count=1)
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


# Iter 57g — Standard-size window snapping. Residential windows are ~99%
# of the time ONE of a fixed set of widths and heights. Claude's vision
# measurements are usually within ±2 in of the true size — snapping
# them to the nearest standard tightens up Vero SKU matching dramatically
# (a 37×61 becomes a 36×60, hitting the right price bucket).
_STD_WIDTHS_IN = (
    18, 20, 24, 28, 30, 32, 34, 36, 40, 42, 44, 48, 54, 60, 66, 72, 78,
    84, 96, 108, 120, 144, 168, 192,
)
_STD_HEIGHTS_IN = (
    24, 30, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 60, 62, 66, 72, 76,
    80, 84, 90, 96,
)
_SNAP_TOLERANCE_IN = 2.5  # how close a guess must be to a standard to snap


def _snap_to_standard(value: float, ladder: tuple[int, ...]) -> float:
    """Snap `value` to the nearest entry in `ladder` if it's within
    `_SNAP_TOLERANCE_IN` inches; otherwise return the value unchanged.
    Keeps outlier sizes (true custom windows) intact — only the noisy
    ±2-in guesses get cleaned up."""
    if value <= 0:
        return value
    nearest = min(ladder, key=lambda s: abs(s - value))
    if abs(nearest - value) <= _SNAP_TOLERANCE_IN:
        return float(nearest)
    return value


def _snap_window_sizes(openings: list) -> list:
    """Snap every `type=window` opening's W and H to nearest standard
    size within tolerance. Mutates and returns the list for convenience
    — caller can ignore the return."""
    for o in openings or []:
        if (o.get("type") or "").lower() != "window":
            continue
        try:
            w = float(o.get("width_in") or 0)
            h = float(o.get("height_in") or 0)
        except (TypeError, ValueError):
            continue
        o["width_in"] = _snap_to_standard(w, _STD_WIDTHS_IN)
        o["height_in"] = _snap_to_standard(h, _STD_HEIGHTS_IN)
    return openings


def _snap_schedule_sizes(schedule: list) -> list:
    """Same snap pass for the openings_schedule rows so the display
    and the openings[] list stay consistent."""
    for o in schedule or []:
        if (o.get("type") or "").lower() != "window":
            continue
        try:
            w = float(o.get("width_in") or 0)
            h = float(o.get("height_in") or 0)
        except (TypeError, ValueError):
            continue
        o["width_in"] = _snap_to_standard(w, _STD_WIDTHS_IN)
        o["height_in"] = _snap_to_standard(h, _STD_HEIGHTS_IN)
        wi = int(round(o["width_in"]))
        hi = int(round(o["height_in"]))
        # Refresh size_label so the snapped value shows in the schedule.
        o["size_label"] = f'{wi}×{hi} in'
    return schedule


def _enforce_symmetry(openings: list) -> list:
    """Iter 57g — if 3+ windows on the SAME wall + style are within a
    few inches of each other, force them all to the SAME size (the
    median W and median H of the cluster). Eliminates the "Claude
    returned 36×60, 35×61, 37×59 for the same row of 4 identical
    front windows" inconsistency."""
    if not openings:
        return openings
    # Bucket windows by (wall, style). Type stays = window throughout.
    buckets: dict[tuple, list[dict]] = {}
    for o in openings:
        if (o.get("type") or "").lower() != "window":
            continue
        wall = (o.get("wall") or "other").lower()
        style = (o.get("style") or "").strip().lower()
        buckets.setdefault((wall, style), []).append(o)
    for cluster in buckets.values():
        if len(cluster) < 3:
            continue
        ws = sorted(float(o.get("width_in") or 0) for o in cluster)
        hs = sorted(float(o.get("height_in") or 0) for o in cluster)
        mw = ws[len(ws) // 2]
        mh = hs[len(hs) // 2]
        # Spread check: if any W is more than 4 in away from median,
        # this isn't really a "set of identical windows" — leave them.
        if max(abs(w - mw) for w in ws) > 4 or max(abs(h - mh) for h in hs) > 4:
            continue
        # Force every member to the median, snapped to a standard size.
        mw_snap = _snap_to_standard(mw, _STD_WIDTHS_IN)
        mh_snap = _snap_to_standard(mh, _STD_HEIGHTS_IN)
        for o in cluster:
            o["width_in"] = mw_snap
            o["height_in"] = mh_snap
    return openings




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


# Iter 78z+ — Format user-drawn profile annotations into a short prompt
# string Claude can read AS GROUND TRUTH. Two roles:
#   1. Tells Claude what the contractor already nailed down — so it
#      doesn't waste detection budget re-classifying those regions.
#   2. Biases Claude toward inferring matching patterns elsewhere. If
#      the user marked the front gable as Shake, the back & right
#      gables PROBABLY are too (houses are symmetrical) — Claude
#      should lean shake on those even when the photo is grainy.
def _build_annotation_hint(annotations: dict | None) -> str:
    if not annotations or not isinstance(annotations, dict):
        return ""
    # Aggregate by (photo_idx, elevation_label, profile) → sqft. The
    # photo_idx maps to the order photos were uploaded; Claude sees
    # them in the same order.
    lines: list[str] = []
    elev_profile_counts: dict[str, list[str]] = {}  # elevation_label → list of profiles
    for key, boxes in annotations.items():
        if key.startswith("_"):
            continue
        if not isinstance(boxes, list):
            continue
        for b in boxes:
            if not isinstance(b, dict):
                continue
            profile = (b.get("profile") or "").strip().lower()
            if not profile:
                continue
            sqft = b.get("sqft") or 0
            try:
                sqft = float(sqft)
            except (TypeError, ValueError):
                sqft = 0
            if sqft <= 0:
                continue
            label = (b.get("elevation_label") or "").strip().lower() or "unknown"
            callout = (b.get("callout") or "").strip()
            note = f" ({callout})" if callout else ""
            lines.append(
                f"  - photo #{int(key) + 1 if key.isdigit() else key}, "
                f"{label}: {profile.upper().replace('_', ' ')} ≈ {sqft:.0f} ft²{note}"
            )
            elev_profile_counts.setdefault(label, []).append(profile)
    if not lines:
        return ""

    # Build "matching pattern" reminder for elevations that have shake/B&B.
    # E.g. "The user marked SHAKE on front. Look CAREFULLY at every other
    # elevation's gable — symmetrical houses repeat the same accent."
    accent_lines = []
    for label, profiles in elev_profile_counts.items():
        unique = {p for p in profiles if p not in ("lap", "dutch_lap")}
        for u in unique:
            accent_lines.append(
                f"  - {u.upper().replace('_', ' ')} appears on {label}; "
                f"look carefully at other elevations for matching {u.upper().replace('_', ' ')} patterns."
            )

    hint = (
        "USER GROUND-TRUTH ANNOTATIONS — the contractor has drawn boxes "
        "on the photos and tagged each region with a profile + sqft. "
        "Use these AS GROUND TRUTH:\n"
        + "\n".join(lines)
    )
    if accent_lines:
        hint += (
            "\n\nMATCHING PATTERN HINTS — siding accents typically "
            "repeat symmetrically on houses. Use the user's tags to "
            "bias your per-elevation profile callouts:\n"
            + "\n".join(accent_lines)
        )
    hint += (
        "\n\nFor any elevation NOT covered by a user annotation, "
        "perform your normal best-effort profile detection. The "
        "annotated regions will land on the materials list "
        "REGARDLESS of what you return — but the more accurately "
        "you reflect them in `per_elevation` walls, the more "
        "useful your output is to the contractor."
    )
    return hint


# =====================================================================
# Iter 57j — DEEP DORMER SCAN
# =====================================================================
# Claude Opus's vision pipeline downsizes every image to ~1568 px on its
# longest edge before tokenizing. On a typical 4032×3024 phone photo of
# a whole house, an 8-foot-wide dormer that's 200 px tall in the original
# becomes ~80 px tall after resize — and after tokenization (one token
# per ~14 px patch), that's effectively 6 tokens of total information.
# Not enough to detect anything subtle like an eyebrow vent or a small
# gable dormer.
#
# Fix: crop the top ~38% of each ground-level photo, upscale 2× (free
# on Claude's side — they downsize anyway), and send it as a SEPARATE
# scoped call asking ONLY for roofline detail.
DORMER_PROMPT = """You are looking at the TOP 38% of a single house photo \
(the roofline). Your only job: find dormers, gable windows, eyebrow vents, \
and any windows set INTO the roof slope. Ignore everything below the eave \
line. Return JSON only:

{
  "found": [
    {"type": "dormer" | "gable_window" | "eyebrow_vent" | "roof_window",
     "style": "Double Hung" | "Single Hung" | "Casement" | "Picture" | "Half-Round" | "Octagon" | "Hexagon" | "Arch" | "Other Shape" | "",
     "width_in": number,
     "height_in": number,
     "wall": "front" | "back" | "left" | "right" | "other",
     "dormer_face_sqft": number,
     "shape": "gable" | "shed" | "eyebrow" | "hip" | "n/a",
     "notes": "<1 sentence>"
    }
  ],
  "scanned": true
}

Rules:
1. ONLY report items in the top 38% of the original photo (above the eave).
2. Typical residential dormer faces are 16-72 ft².
3. If you see NOTHING, return {"found": [], "scanned": true}. Don't invent.
4. JSON only. No markdown fences.
"""


def _crop_top_strip(raw_bytes: bytes, top_pct: float = 0.38, upscale: float = 2.0) -> Optional[bytes]:
    """Take the top `top_pct` of `raw_bytes`, optionally upscale by
    `upscale`, return JPEG bytes ready to send to Claude."""
    try:
        with Image.open(io.BytesIO(raw_bytes)) as im:
            im.load()
            w, h = im.size
            if w <= 0 or h <= 0:
                return None
            crop_h = max(1, int(h * top_pct))
            strip = im.crop((0, 0, w, crop_h))
            if upscale and upscale > 1.0:
                long_edge = max(strip.size)
                if long_edge < 1568:
                    new_w = int(strip.size[0] * upscale)
                    new_h = int(strip.size[1] * upscale)
                    strip = strip.resize((new_w, new_h), Image.NEAREST)
            if strip.mode in ("RGBA", "P"):
                strip = strip.convert("RGB")
            buf = io.BytesIO()
            strip.save(buf, format="JPEG", quality=82, optimize=True)
            return buf.getvalue()
    except Exception:
        return None


async def _run_dormer_pass_for_photo(
    api_key: str, user_id: str, raw_bytes: bytes, wall_hint: str, photo_idx: int,
) -> list[dict]:
    """Run ONE dormer-scan call against a single photo's cropped top strip."""
    cropped = _crop_top_strip(raw_bytes)
    if not cropped:
        return []
    chat = LlmChat(
        api_key=api_key,
        session_id=f"dormer-scan-{user_id}-{uuid.uuid4().hex[:8]}",
        system_message=DORMER_PROMPT,
    ).with_model("anthropic", MODEL_NAME)
    user_msg = UserMessage(
        text=(
            f"This is the top 38% (roofline strip) of an exterior house "
            f"photo. Wall hint: '{wall_hint or 'unknown'}' — if you find "
            f"dormers or roof windows, tag them on this wall unless "
            f"the geometry obviously says otherwise. Return JSON only."
        ),
        file_contents=[ImageContent(image_base64=base64.b64encode(cropped).decode("ascii"))],
    )
    try:
        reply = await chat.send_message(user_msg)
    except Exception:
        return []
    try:
        payload = _json_from_reply(reply or "")
    except Exception:
        return []
    found = payload.get("found") or []
    out: list[dict] = []
    for f in found:
        try:
            w = float(f.get("width_in") or 0)
            h = float(f.get("height_in") or 0)
        except (TypeError, ValueError):
            continue
        if w <= 0 and h <= 0 and not f.get("dormer_face_sqft"):
            continue
        out.append({
            **f,
            "_photo_index": photo_idx,
            "_via_dormer_scan": True,
        })
    return out


def _is_skyline_photo(elev: str) -> bool:
    """Aerial and Detail shots don't have rooflines to scan."""
    e = (elev or "").lower()
    return e in ("aerial", "detail")


def _merge_dormer_hits(raw: dict, dormer_hits: list[dict]) -> None:
    """Merge dormer-scan hits into `openings[]` + `walls[].dormer_face_sqft`."""
    if not dormer_hits:
        return
    existing_keys: set[tuple] = set()
    for o in raw.get("openings") or []:
        try:
            w = float(o.get("width_in") or 0)
            h = float(o.get("height_in") or 0)
        except (TypeError, ValueError):
            continue
        existing_keys.add((
            (o.get("wall") or "other").lower(),
            (o.get("type") or "").lower(),
            round(w / 6) * 6,
            round(h / 6) * 6,
        ))

    added_openings = 0
    dormer_sf_by_wall: dict[str, float] = {}
    walls = raw.get("walls") or []
    wall_index = {(w.get("label") or "").lower(): w for w in walls}
    for h in dormer_hits:
        wi = float(h.get("width_in") or 0)
        hi = float(h.get("height_in") or 0)
        wall = (h.get("wall") or "other").lower()
        dormer_face = float(h.get("dormer_face_sqft") or 0)
        if wi > 0 and hi > 0:
            key = (wall, "window", round(wi / 6) * 6, round(hi / 6) * 6)
            if key not in existing_keys:
                raw.setdefault("openings", []).append({
                    "type": "window",
                    "style": (h.get("style") or "").strip(),
                    "style_confidence": 90,
                    "width_in": wi,
                    "height_in": hi,
                    "wall": wall,
                    "_via_dormer_scan": True,
                })
                existing_keys.add(key)
                added_openings += 1
        if dormer_face > 0:
            dormer_sf_by_wall[wall] = dormer_sf_by_wall.get(wall, 0) + dormer_face

    for wall, sf in dormer_sf_by_wall.items():
        w = wall_index.get(wall)
        if w is None:
            new_wall = {
                "label": wall, "width_ft": 0, "height_ft": 0,
                "gable_triangle_height_ft": 0,
                "dormer_face_sqft": sf,
                "siding_pct_this_wall": 100,
                "confidence": 50,
                "confidence_reasoning": "Synthesized from dormer scan — verify the wall's main dimensions.",
            }
            walls.append(new_wall)
            wall_index[wall] = new_wall
        else:
            w["dormer_face_sqft"] = float(w.get("dormer_face_sqft") or 0) + sf

    raw["walls"] = walls
    raw["dormer_scan_added_openings"] = added_openings
    raw["dormer_scan_added_sf_by_wall"] = dormer_sf_by_wall
    prev_notes = (raw.get("notes") or "").strip()
    total_added_sf = sum(dormer_sf_by_wall.values())
    if added_openings or total_added_sf:
        marker = (
            f"Deep dormer scan added {added_openings} opening"
            f"{'s' if added_openings != 1 else ''}"
            + (f" and {total_added_sf:.0f} ft² of dormer face area" if total_added_sf else "")
            + " from roofline crops. "
        )
        raw["notes"] = (marker + prev_notes).strip()



def _aggregate_to_hover_shape(raw: dict, annotations: dict | None = None) -> dict:
    """Roll up Claude's per-wall / per-opening estimates into the same
    measurements dict that the HOVER PDF importer returns. The frontend
    diff modal is reused 1-for-1.

    Iter 78z — When `annotations` is provided (user-drawn profile boxes
    from the ProfileAnnotator), they're layered on top of Claude's
    auto-detected breakdown as authoritative accent overrides. See
    `apply_annotations_to_breakdown` in profile_callouts.py.

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
    # Iter 57g order: 1) dedupe, 2) enforce symmetry on like-windows,
    # 3) snap each window to nearest standard residential size. Doing
    # dedupe first reduces the cluster sizes that symmetry sees.
    openings = _dedupe_openings(raw_openings)
    openings = _enforce_symmetry(openings)
    openings = _snap_window_sizes(openings)
    # Snap the schedule rolls too so the on-screen + PDF tables match.
    if raw.get("openings_schedule"):
        raw["openings_schedule"] = _snap_schedule_sizes(raw["openings_schedule"])
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

    # Iter 57i — counts come from the openings_schedule (Claude's
    # grouped roll-up with `count: N` per row) rather than the deduped
    # `openings` list. The dedupe step collapses identical 36×54 DH
    # windows on the same wall into 1 entry, which is correct for the
    # dedupe purpose (eliminating cross-photo duplicates) but
    # under-counts when a wall genuinely has 3 identical-but-distinct
    # windows. The schedule preserves these counts.
    schedule_for_counts = raw.get("openings_schedule") or []
    counts = {"window": 0, "entry_door": 0, "patio_door": 0, "garage_door": 0}
    perimeter_lf = 0.0
    if schedule_for_counts:
        for o in schedule_for_counts:
            t = (o.get("type") or "other").lower()
            cnt = int(o.get("count") or 0)
            if t in counts:
                counts[t] += cnt
            perimeter_lf += cnt * 2 * (
                (float(o.get("width_in") or 0) + float(o.get("height_in") or 0)) / 12.0
            )
    else:
        # Legacy sessions without a schedule fall back to the dedupe
        # list — preserves backwards compatibility.
        for o in openings:
            t = o.get("type", "other")
            if t in counts:
                counts[t] += 1
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
    # Iter 78z — Per-elevation breakdown (lap / shake / B&B / etc.) so
    # the takeoff card can render a profile-by-elevation table and the
    # catalog mapper can split siding into multiple SKU lines.
    try:
        from profile_callouts import breakdown_walls_by_profile, apply_annotations_to_breakdown
        breakdown = breakdown_walls_by_profile(walls)
        # Iter 78z — apply user annotations as authoritative accent
        # overrides (from the ProfileAnnotator UI). Annotations win
        # within the boxed region; Claude's auto-detect still drives
        # body/gable/dormer outside the box.
        breakdown = apply_annotations_to_breakdown(breakdown, annotations)
        measurements["_per_elevation_breakdown"] = breakdown["per_elevation"]
        measurements["_per_profile_sqft"] = breakdown["per_profile_sqft"]
    except Exception:
        # Never let the breakdown helper block a successful measurement
        # response — Claude's wall data may have unusual shapes from old
        # sessions.
        measurements["_per_elevation_breakdown"] = []
        measurements["_per_profile_sqft"] = {}
    return measurements


@router.post("/ai-measure")
async def ai_measure(
    files: list[UploadFile] = File(default=[]),
    photo_paths: Optional[str] = Form(None),
    reference_dim: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    kind: str = Form("siding"),
    overhang_in: float = Form(12.0),
    # Iter 57g — optional course-counting context. If the contractor
    # tells us the brick course or siding exposure, Claude can size
    # windows by counting visible courses (way more accurate than
    # eyeballing pixel ratios). Defaults are residential standards.
    brick_course_in: Optional[float] = Form(None),       # e.g. 8.0 for standard 3-bricks-per-8"
    siding_exposure_in: Optional[float] = Form(None),    # e.g. 5.0 for D5 lap, 6.0 for D6, 7.0 for Cedar Impressions
    # Iter 57j — Deep Dormer Scan. When True, after the main multi-photo
    # Claude pass we ALSO fan out a parallel pass per ground-level photo
    # that crops the top 38% of the image, 2× upscales it, and asks
    # Claude to look ONLY for dormers / gable windows / eyebrow vents.
    # Catches small dormers that get lost when Claude downsizes
    # full-house photos to 1568 px. Default OFF (~5–10 s slower).
    deep_dormer_scan: bool = Form(False),
    # Comma-aligned list of per-photo elevation tags ("front,back,left,
    # right,aerial,detail,...") matching the order of `photo_paths` then
    # `files`. Used to skip aerial/detail shots in the dormer pass and
    # to seed `wall_hint` so the dormer pass can tag found dormers on
    # the right wall without guessing.
    elevation_tags: Optional[str] = Form(None),
    # Iter 57r — Resume support. When the caller is running this from
    # inside an estimate, pass `estimate_id` so we can persist the run
    # against it. Then `GET /ai-measure/latest-for-estimate/{eid}` can
    # return the most recent in-flight or done run, letting the
    # frontend "Resume" after a page reload / screen lock.
    estimate_id: Optional[str] = Form(None),
    user: dict = Depends(get_current_user),
):
    """Kick off an async AI photo-measure run. Iter 57q: the old
    synchronous flow was hitting Kubernetes ingress timeouts (~100 s)
    on 8-photo houses with Deep Dormer Scan enabled. Now this route
    just validates inputs + spawns a background worker, returning
    `{run_id, status: "running"}` in under a second. The frontend
    polls `/api/measure/ai-measure/status/{run_id}` until the worker
    writes the final result to the `ai_measure_runs` collection.

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
    for _ctype, raw in image_payloads:
        if len(raw) > MAX_BYTES_PER_FILE:
            raise HTTPException(
                status_code=413,
                detail="Photo exceeds 12 MB limit",
            )
    # Compress every photo to fit comfortably under Anthropic's 10 MB
    # base64 cap. Modern phone photos at 8–12 MB explode past the limit
    # once base64-encoded (×1.33). Forces JPEG so we also dodge any
    # PNG-from-screenshot bloat.
    image_payloads = [
        ("image/jpeg", _compress_for_claude(raw)) for _ctype, raw in image_payloads
    ]

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY missing on server")

    user_id = user.get("id") or "anon"
    run_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    # Persist a "running" run doc so the status endpoint can return
    # progress even before the worker writes its first stage update.
    # Image bytes stay in memory in the worker's closure — too large
    # to write into MongoDB (8 photos × 8 MB = 64 MB per run).
    await db.ai_measure_runs.insert_one({
        "run_id": run_id,
        "user_id": user_id,
        "estimate_id": estimate_id,
        "status": "running",
        "stage": "starting",
        "photo_count": len(image_payloads),
        # Iter 57r — keep the original `photo_paths` string so resume can
        # restore the contractor's photo grid without re-uploading.
        "photo_paths": photo_paths,
        "deep_dormer_scan": deep_dormer_scan,
        "kind": kind,
        "address": address,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
        "result": None,
        "error": None,
    })

    # Spawn the worker as a true detached task — outlives the request.
    asyncio.create_task(_execute_ai_measure_worker(
        run_id=run_id,
        image_payloads=image_payloads,
        api_key=api_key,
        user_id=user_id,
        address=address,
        reference_dim=reference_dim,
        kind=kind,
        overhang_in=overhang_in,
        brick_course_in=brick_course_in,
        siding_exposure_in=siding_exposure_in,
        deep_dormer_scan=deep_dormer_scan,
        elevation_tags=elevation_tags,
        estimate_id=estimate_id,
    ))

    return {
        "run_id": run_id,
        "status": "running",
        "stage": "starting",
        "photo_count": len(image_payloads),
        "deep_dormer_scan": deep_dormer_scan,
    }


# Iter 78z+ — Re-run a previous AI Measure launch using the CACHED
# photo bytes. Mirrors the blueprint rerun: lets the contractor save
# profile annotations and fire a fresh Claude pass without re-uploading
# the photo grid.
@router.post("/ai-measure/rerun/{prev_run_id}")
async def ai_measure_rerun(
    prev_run_id: str,
    user: dict = Depends(get_current_user),
):
    prev = await db.ai_measure_runs.find_one({"run_id": prev_run_id})
    if not prev:
        raise HTTPException(status_code=404, detail="Previous run not found")
    user_id = user.get("id") or "anon"
    if prev.get("user_id") not in (user_id, "anon"):
        raise HTTPException(status_code=403, detail="Not your run")

    photo_paths_str = prev.get("photo_paths") or ""
    paths = [p.strip() for p in photo_paths_str.split(",") if p.strip()]
    if not paths:
        raise HTTPException(
            status_code=400,
            detail="No cached photos on this run — re-upload to use rerun",
        )
    from config import UPLOAD_DIR  # local import to dodge cycle
    image_payloads: list[tuple[str, bytes]] = []
    for name in paths:
        target = UPLOAD_DIR / name
        if not target.exists():
            continue
        raw = target.read_bytes()
        # Reuse the same compressor the primary pass uses so the box
        # coordinates from the annotator line up with what Claude sees.
        image_payloads.append((name, _compress_for_claude(raw)))
    if not image_payloads:
        raise HTTPException(
            status_code=400,
            detail="Cached photos are no longer on disk — re-upload",
        )

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY missing on server")

    new_run_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    address = prev.get("address")
    estimate_id = prev.get("estimate_id")
    kind = prev.get("kind") or "siding"
    deep_dormer_scan = bool(prev.get("deep_dormer_scan") or False)

    # Pull worker params from the previous result's measurements when
    # available; fall back to sane defaults that match the form schema.
    prev_meas = ((prev.get("result") or {}).get("measurements") or {})
    prev_overhang = 12.0
    try:
        if prev_meas.get("overhang_in") is not None:
            prev_overhang = float(prev_meas["overhang_in"])
    except Exception:
        prev_overhang = 12.0

    await db.ai_measure_runs.insert_one({
        "run_id":          new_run_id,
        "user_id":         user_id,
        "estimate_id":     estimate_id,
        "status":          "running",
        "stage":           "starting",
        "photo_count":     len(image_payloads),
        "photo_paths":     ",".join(name for name, _ in image_payloads),
        "deep_dormer_scan": deep_dormer_scan,
        "kind":            kind,
        "address":         address,
        "rerun_of":        prev_run_id,
        "created_at":      now,
        "updated_at":      now,
        "completed_at":    None,
        "result":          None,
        "error":           None,
    })
    asyncio.create_task(_execute_ai_measure_worker(
        run_id=new_run_id,
        image_payloads=image_payloads,
        api_key=api_key,
        user_id=user_id,
        address=address,
        reference_dim=None,
        kind=kind,
        overhang_in=prev_overhang,
        brick_course_in=None,
        siding_exposure_in=None,
        deep_dormer_scan=deep_dormer_scan,
        elevation_tags=None,
        estimate_id=estimate_id,
    ))
    return {
        "run_id":           new_run_id,
        "status":           "running",
        "stage":            "starting",
        "photo_count":      len(image_payloads),
        "deep_dormer_scan": deep_dormer_scan,
        "rerun_of":         prev_run_id,
    }


def _as_aware_utc(dt):
    """Coerce a datetime to a timezone-aware UTC datetime. MongoDB may
    return naive datetimes depending on the driver/codec settings, which
    breaks arithmetic against `datetime.now(timezone.utc)`."""
    if not isinstance(dt, datetime):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("/ai-measure/status/{run_id}")
async def ai_measure_status(
    run_id: str,
    user: dict = Depends(get_current_user),
):
    """Poll the status of an async AI measure run.

    Returns:
        {
          status: "running" | "done" | "error",
          stage: "starting"|"claude"|"dormer_scan"|"aggregating"|"mapping",
          result: {...measurements/raw_ai/lines/vero_openings...} | None,
          error: str | None,
          elapsed_ms: int,
        }
    """
    doc = await db.ai_measure_runs.find_one({"run_id": run_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Run not found")
    if doc.get("user_id") not in (user.get("id"), "anon"):
        raise HTTPException(status_code=403, detail="Not your run")
    created = _as_aware_utc(doc.get("created_at"))
    completed = _as_aware_utc(doc.get("completed_at") or doc.get("updated_at"))
    elapsed_ms = None
    if created is not None:
        ref = completed if completed is not None else datetime.now(timezone.utc)
        elapsed_ms = int((ref - created).total_seconds() * 1000)
    return {
        "run_id": run_id,
        "status": doc.get("status"),
        "stage": doc.get("stage"),
        "result": doc.get("result"),
        "error": doc.get("error"),
        "elapsed_ms": elapsed_ms,
    }


@router.get("/ai-measure/latest-for-estimate/{estimate_id}")
async def ai_measure_latest_for_estimate(
    estimate_id: str,
    user: dict = Depends(get_current_user),
):
    """Iter 57r — Resume support. Returns the most recent AI Measure
    run for this user+estimate (regardless of status), or `null` if
    none exists. Used by the AI Measure modal to surface a "Resume" or
    "Restore preview" banner after a page reload / screen lock.
    """
    user_id = user.get("id") or "anon"
    doc = await db.ai_measure_runs.find_one(
        {"user_id": user_id, "estimate_id": estimate_id},
        sort=[("created_at", -1)],
    )
    if not doc:
        return {"run": None}
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
            "photo_count": doc.get("photo_count"),
            "photo_paths": doc.get("photo_paths"),
            "deep_dormer_scan": doc.get("deep_dormer_scan"),
            "result": doc.get("result"),
            "error": doc.get("error"),
            "elapsed_ms": elapsed_ms,
            "age_seconds": age_seconds,
        },
    }


async def _execute_ai_measure_worker(
    *,
    run_id: str,
    image_payloads: list[tuple[str, bytes]],
    api_key: str,
    user_id: str,
    address: Optional[str],
    reference_dim: Optional[str],
    kind: str,
    overhang_in: float,
    brick_course_in: Optional[float],
    siding_exposure_in: Optional[float],
    deep_dormer_scan: bool,
    elevation_tags: Optional[str],
    estimate_id: Optional[str] = None,
):
    """Background worker — runs the Claude call(s), aggregates, maps to
    catalog lines, and writes the final result back to the run doc.
    Errors get written as `status: "error"` with a friendly message
    so the frontend's polling loop can surface them."""
    async def _set_stage(stage: str):
        await db.ai_measure_runs.update_one(
            {"run_id": run_id},
            {"$set": {"stage": stage, "updated_at": datetime.now(timezone.utc)}},
        )
    try:
        await _set_stage("claude")
        # Iter 78z+ (Annotations as Claude hints) — Load user-drawn boxes
        # from the estimate BEFORE the primary Claude call so we can
        # surface them in the prompt. Claude uses them as ground truth
        # AND can infer matching profile patterns on other elevations
        # (e.g. user marked the front gable as Shake → Claude is biased
        # toward calling matching scallop patterns on the back/right
        # gables as Shake too instead of defaulting to lap).
        annotations: dict | None = None
        if estimate_id:
            est_doc = await db.estimates.find_one(
                {"id": estimate_id},
                {"_id": 0, "profile_annotations": 1},
            )
            if est_doc:
                annotations = est_doc.get("profile_annotations") or None
        annotation_hint = _build_annotation_hint(annotations)

        image_contents = [
            ImageContent(image_base64=base64.b64encode(raw).decode("ascii"))
            for _ct, raw in image_payloads
        ]
        session_id = f"ai-measure-{user_id}-{uuid.uuid4().hex[:8]}"
        chat = LlmChat(
            api_key=api_key,
            session_id=session_id,
            system_message=SYSTEM_PROMPT,
        ).with_model("anthropic", MODEL_NAME)

        prompt_parts = []
        if address:
            prompt_parts.append(f"Property address: {address}")
        if reference_dim:
            prompt_parts.append(
                f"Reference dimension provided by contractor: {reference_dim}. "
                "Anchor all scale to this."
            )
        course_hints = []
        if brick_course_in and brick_course_in > 0:
            course_hints.append(
                f"BRICK COURSE = {brick_course_in:.2f} inches (one brick + mortar = this height). "
                f"If brick is visible anywhere in a photo, COUNT THE COURSES "
                f"between the sill and head of each window to size it: "
                f"{brick_course_in:.2f} in × course count = window height. "
                f"This is far more accurate than estimating pixel ratios."
            )
        if siding_exposure_in and siding_exposure_in > 0:
            course_hints.append(
                f"SIDING EXPOSURE = {siding_exposure_in:.2f} inches (one visible "
                f"siding row = this height). On siding-clad walls, count visible "
                f"siding rows between the sill and head: {siding_exposure_in:.2f} in × "
                f"row count = window height."
            )
        if course_hints:
            prompt_parts.append("\n".join(course_hints))
        prompt_parts.append(
            "STANDARD-SIZE RESIDENTIAL WINDOWS — most windows are one of "
            "these widths: 18, 20, 24, 28, 30, 32, 34, 36, 40, 42, 44, 48, "
            "54, 60, 66, 72 in. Heights: 24, 30, 36, 38, 40, 42, 44, 46, 48, "
            "50, 52, 54, 60, 62, 66, 72 in. If your initial pixel measurement "
            "is within 2-3 inches of a standard, EMIT THE STANDARD (the "
            "backend will snap exact matches anyway, but rounding yourself "
            "first reduces noise). Doors: entry 36×80 (or 32×80, 30×80); "
            "patio 60×80 / 72×80; garage 96×84 (single), 192×84 (double)."
        )
        prompt_parts.append(
            "SYMMETRY / REPETITION — if you see 3+ windows on the same wall "
            "that look identical (same operation style, similar W and H), "
            "they ARE identical (houses don't have 4 windows in a row of "
            "different sizes — that's a builder error). Emit them ALL with "
            "the SAME width_in and height_in. The backend also enforces this "
            "but you doing it cleanly produces fewer dedupe artefacts."
        )
        prompt_parts.append(
            "Photos attached below. Return the JSON measurement object now."
        )
        # Iter 78z+ — Annotation hints (ground-truth boxes from the
        # contractor) inserted right before the schema marker so Claude
        # can use them throughout its analysis.
        if annotation_hint:
            prompt_parts.append(annotation_hint)
        user_text = "\n".join(prompt_parts)

        reply_text = await chat.send_message(
            UserMessage(text=user_text, file_contents=image_contents),
        )
        raw = _json_from_reply(reply_text or "")

        if deep_dormer_scan:
            await _set_stage("dormer_scan")
            elev_list = [
                (t or "").strip().lower()
                for t in (elevation_tags or "").split(",")
            ]
            while len(elev_list) < len(image_payloads):
                elev_list.append("")
            dormer_coros = []
            for idx, ((_ctype, raw_bytes), elev) in enumerate(zip(image_payloads, elev_list)):
                if _is_skyline_photo(elev):
                    continue
                dormer_coros.append(
                    _run_dormer_pass_for_photo(api_key, user_id, raw_bytes, elev, idx)
                )
            if dormer_coros:
                results = await asyncio.gather(*dormer_coros, return_exceptions=True)
                all_hits: list[dict] = []
                for r in results:
                    if isinstance(r, list):
                        all_hits.extend(r)
                _merge_dormer_hits(raw, all_hits)

        await _set_stage("aggregating")
        # Iter 78z — Annotations were already loaded above (for the
        # Claude hint). Reuse them as the breakdown overlay so the
        # catalog mapper emits per-profile lines.
        measurements = _aggregate_to_hover_shape(raw, annotations=annotations)
        measurements["overhang_in"] = float(overhang_in)

        await _set_stage("mapping")
        try:
            lines = _build_lines(measurements)
        except Exception:
            lines = []
        # Iter 78o — Phase 1 sanity checks on AI-Measure / Blueprint runs.
        try:
            from routes.hover_sanity import run_checks
            warnings = run_checks(measurements)
        except Exception:
            warnings = []

        result = {
            "measurements": measurements,
            "lines": lines,
            "vero_openings": _build_vero_openings_from_ai(
                raw.get("openings") or [],
                raw.get("openings_schedule") or [],
            ),
            "raw_ai": raw,
            "model": MODEL_NAME,
            "session_id": session_id,
            "warnings": warnings,
        }
        await db.ai_measure_runs.update_one(
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
        # Log & surface a friendly error to the polling client.
        logger.exception("[ai-measure] worker failed for run_id=%s", run_id)
        await db.ai_measure_runs.update_one(
            {"run_id": run_id},
            {"$set": {
                "status": "error",
                "stage": "error",
                "error": f"AI measure failed: {e}",
                "completed_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }},
        )


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
    # Iter 78o — Phase 1 sanity checks also run on the cached-measurement
    # restore path so the "Restore HOVER lines" modal shows the same
    # warning banner the fresh-import flow does.
    try:
        from routes.hover_sanity import run_checks
        warnings = run_checks(measurements)
    except Exception:
        warnings = []
    return {"measurements": measurements, "lines": lines, "vero_openings": [], "warnings": warnings}



# =====================================================================
# Iter 78z (Cross-Check) — Reference photo cross-check.
#
# After the primary AI Measure pass, the contractor can fire this
# secondary Claude pass to VERIFY the per-elevation profile callouts
# against the same uploaded photos. The 2nd pass uses a focused prompt
# that biases Claude toward catching:
#   - Small accents the primary pass missed (porch B&B, column shake)
#   - Profile mis-classification (lap vs dutch lap, shake vs B&B)
#   - Stone / brick watertable mis-reads
#
# Returns:
#   conflicts:         [{elev, role, primary, verified, confidence, note}]
#   suggested_accents: [{elev, location, profile, approx_sqft, confidence}]
#   overall_confidence: high/medium/low
#   agreement_pct:     0-100 (% of roles where primary == verified)
# =====================================================================
CROSS_CHECK_PROMPT = """\
You are a SECOND-PASS verification agent for a siding takeoff. You already
analyzed these photos in a first pass; now do a careful re-check ONLY
of the per-elevation siding profile callouts.

Look for these specific failure modes the first pass commonly misses:
1. SMALL ACCENT PANELS — porch face B&B, column wrap shake, small dormer
   scallop, gable-vent surround. These get lost when Claude downsizes
   full-house photos.
2. PROFILE MIS-CLASSIFICATION — lap vs dutch lap (notched bottom edge),
   shake vs board & batten (vertical battens vs staggered courses),
   nickel gap vs plain vertical.
3. MASONRY MIS-READ — stone / brick watertable or wainscot the first
   pass might have missed (would reduce siding ft²).

Canonical profile families (use these exact strings):
  lap | dutch_lap | shake | board_batten | vertical | nickel_gap |
  stone | brick | stucco | unknown

You MUST return JSON only. Schema:
{
  "overall_confidence": "high" | "medium" | "low",
  "per_elevation": [
    {
      "label": "front" | "back" | "left" | "right" | etc,
      "body_profile":  "<one of the canonical families>",
      "gable_profile": "<canonical family or empty>",
      "dormer_profile": "<canonical family or empty>",
      "accents": [
        {
          "location":       "<short, e.g. 'porch face' / 'column wrap' / 'dormer scallop'>",
          "profile":        "<canonical family>",
          "approx_sqft":    number,
          "confidence":     "high" | "medium" | "low",
          "callout":        "<what visually told you, 1 short phrase>"
        }
      ],
      "notes": "<1 sentence on anything unusual, or empty>"
    }
  ]
}

Be CONSERVATIVE on accents — only flag accents you can clearly see in
the photos. Don't invent details. If the photo is too small/blurry,
mark confidence: "low" and note the limitation.
"""


def _normalize_family(s) -> str:
    """Best-effort normalization of a profile string to a canonical
    family. Tolerates the primary breakdown's labels + raw Claude
    output. Returns empty string when unparseable."""
    if not s:
        return ""
    s = str(s).strip().lower().replace("-", "_").replace(" ", "_")
    if s in {"lap", "dutch_lap", "shake", "board_batten", "vertical",
             "nickel_gap", "stone", "brick", "stucco", "unknown"}:
        return s
    # Forgive a few common Claude outputs
    if s in {"clapboard", "horizontal_lap"}:
        return "lap"
    if s in {"dutchlap"}:
        return "dutch_lap"
    if s in {"shaker", "shingle", "shingles", "fish_scale", "scallop"}:
        return "shake"
    if s in {"bnb", "b&b", "batten"}:
        return "board_batten"
    return ""


def _compute_recheck_diff(primary_per_elev: list, verified: dict) -> dict:
    """Compare the primary per_elevation_breakdown vs the verifier's
    output and produce conflicts + suggested_accents. The verifier
    returns its result keyed by `label` (lowercase). Roles compared:
    body / gable / dormer. Accent comparison is by (location, profile)
    fuzzy match — anything in the verifier not seen in primary is a
    suggestion."""
    conflicts = []
    suggested_accents = []
    total_role_comparisons = 0
    matches = 0

    primary_by_label = {
        (e.get("label") or "").strip().lower(): e for e in (primary_per_elev or [])
    }
    verified_per_elev = verified.get("per_elevation") or []

    for v_elev in verified_per_elev:
        v_label = (v_elev.get("label") or "").strip().lower()
        p_elev = primary_by_label.get(v_label) or {}

        # Compare each role
        for role, p_key, v_key in [
            ("body",   "wall_body_profile", "body_profile"),
            ("gable",  "gable_profile",     "gable_profile"),
            ("dormer", "dormer_profile",    "dormer_profile"),
        ]:
            p_fam = _normalize_family(p_elev.get(p_key))
            v_fam = _normalize_family(v_elev.get(v_key))
            # Only compare when verifier produced an opinion AND the
            # primary had a value to compare against.
            if not v_fam:
                continue
            if role == "body" and not p_fam:
                # Primary had no body profile but verifier does — surface
                # as a conflict so the contractor can review.
                conflicts.append({
                    "elev": v_label,
                    "role": role,
                    "primary": "",
                    "verified": v_fam,
                    "confidence": v_elev.get("overall_confidence") or "medium",
                    "note": f"Verifier identified {v_fam} body siding; primary had no callout",
                })
                continue
            if not p_fam:
                continue
            total_role_comparisons += 1
            if p_fam == v_fam:
                matches += 1
            else:
                conflicts.append({
                    "elev": v_label,
                    "role": role,
                    "primary": p_fam,
                    "verified": v_fam,
                    "confidence": v_elev.get("overall_confidence") or "medium",
                    "note": f"Primary said {p_fam}, verifier says {v_fam}",
                })

        # Suggested accents: anything in verifier not already in primary's
        # accents list. Match by (profile, location) approximate.
        p_accents = p_elev.get("accents") or []
        p_keys = {
            (
                _normalize_family(a.get("profile")),
                (a.get("location") or "").strip().lower(),
            )
            for a in p_accents
        }
        for v_acc in (v_elev.get("accents") or []):
            v_fam = _normalize_family(v_acc.get("profile"))
            if not v_fam:
                continue
            v_loc = (v_acc.get("location") or "").strip().lower()
            if (v_fam, v_loc) in p_keys:
                continue  # already on the primary breakdown
            try:
                sqft = float(v_acc.get("approx_sqft") or 0)
            except (TypeError, ValueError):
                sqft = 0
            if sqft <= 0:
                continue
            suggested_accents.append({
                "elev": v_label,
                "location": v_acc.get("location") or "accent",
                "profile": v_fam,
                "approx_sqft": round(sqft, 1),
                "confidence": v_acc.get("confidence") or "medium",
                "callout": v_acc.get("callout") or "",
            })

    agreement_pct = round((matches / total_role_comparisons * 100), 1) if total_role_comparisons > 0 else 100.0
    return {
        "overall_confidence": verified.get("overall_confidence") or "medium",
        "agreement_pct": agreement_pct,
        "conflicts": conflicts,
        "suggested_accents": suggested_accents,
        "verified_per_elevation": verified_per_elev,
    }


@router.post("/ai-cross-check/{run_id}")
async def ai_cross_check(
    run_id: str,
    user: dict = Depends(get_current_user),
):
    """Iter 78z — Reference photo cross-check.

    Fires a SECOND Claude vision pass against the same photos the
    primary AI Measure run used, focused exclusively on verifying the
    per-elevation profile callouts. Returns a diff (conflicts +
    suggested accents) the frontend can render inline on the takeoff
    preview. Patches the run document with the recheck result so
    subsequent loads can show it without re-running Claude.
    """
    doc = await db.ai_measure_runs.find_one({"run_id": run_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Run not found")
    if doc.get("user_id") not in (user.get("id"), "anon"):
        raise HTTPException(status_code=403, detail="Not your run")
    if doc.get("status") != "done":
        raise HTTPException(
            status_code=409,
            detail="Primary run is not complete yet — wait for it to finish first",
        )

    # Reload the original photo bytes from disk via the cached paths.
    photo_paths_str = doc.get("photo_paths") or ""
    paths = [p.strip() for p in photo_paths_str.split(",") if p.strip()]
    if not paths:
        raise HTTPException(
            status_code=400,
            detail="No cached photos on this run — re-upload to use cross-check",
        )
    from config import UPLOAD_DIR  # local import to dodge cycle
    image_payloads: list[bytes] = []
    for name in paths:
        target = UPLOAD_DIR / name
        if not target.exists():
            continue
        raw = target.read_bytes()
        # Reuse the same compressor the primary pass uses.
        image_payloads.append(_compress_for_claude(raw))
    if not image_payloads:
        raise HTTPException(
            status_code=400,
            detail="None of the cached photos are still on disk — re-upload to use cross-check",
        )

    # Pull the primary breakdown from the saved run.
    result = doc.get("result") or {}
    primary_measurements = result.get("measurements") or {}
    primary_per_elev = primary_measurements.get("_per_elevation_breakdown") or []

    # Build the summary that prefaces the verification prompt so Claude
    # knows what the primary pass already concluded.
    if primary_per_elev:
        summary_lines = ["First-pass conclusions (verify or correct each row):"]
        for e in primary_per_elev:
            label = e.get("label") or "unknown"
            body = e.get("wall_body_profile") or ""
            gable = e.get("gable_profile") or ""
            dormer = e.get("dormer_profile") or ""
            accents = e.get("accents") or []
            acc_str = (
                " | ".join(f"{a.get('profile')}@{a.get('location')}" for a in accents)
                if accents else "none"
            )
            summary_lines.append(
                f"  - {label}: body={body or 'unknown'}, "
                f"gable={gable or 'none'}, dormer={dormer or 'none'}, "
                f"accents=[{acc_str}]"
            )
        summary = "\n".join(summary_lines)
    else:
        summary = "First pass produced no per-elevation breakdown. Build one from scratch."

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY missing on server")

    session_id = f"ai-cross-check-{user.get('id', 'anon')}-{uuid.uuid4().hex[:8]}"
    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=CROSS_CHECK_PROMPT,
    ).with_model("anthropic", MODEL_NAME)

    image_contents = [
        ImageContent(image_base64=base64.b64encode(b).decode("ascii"))
        for b in image_payloads
    ]
    user_text = (
        summary
        + "\n\nNow re-examine the photos and return your verification JSON."
    )
    try:
        reply_text = await chat.send_message(
            UserMessage(text=user_text, file_contents=image_contents),
        )
        verified = _json_from_reply(reply_text or "")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[ai-cross-check] Claude call failed for run_id=%s", run_id)
        raise HTTPException(
            status_code=502,
            detail=f"Cross-check pass failed: {e}",
        ) from e

    # Diff vs primary breakdown
    recheck = _compute_recheck_diff(primary_per_elev, verified)

    # Persist on the run so subsequent loads can resurface without re-paying.
    primary_measurements["_ai_profile_recheck"] = recheck
    await db.ai_measure_runs.update_one(
        {"run_id": run_id},
        {"$set": {
            "result.measurements._ai_profile_recheck": recheck,
            "updated_at": datetime.now(timezone.utc),
        }},
    )

    return {"run_id": run_id, "recheck": recheck}



# ---------------------------------------------------------------------------
# Iter 78z+ — OCR Auto-Scale endpoint.
#
# Pointed at a blueprint page (or photo) URL, this endpoint runs a small
# focused Claude vision call to:
#   1. Find a labeled wall dimension on the image (e.g. "30'-0\"" arrow)
#   2. Return the pixel endpoints of that dimension line + the labeled ft
#   3. Optionally surface the scale notation ("SCALE 1/4\" = 1'-0\"")
#
# Frontend uses (px_height, real_ft) to set the ProfileAnnotator's
# scale_ref — same shape as the manual drag UI but zero-click.
# ---------------------------------------------------------------------------
OCR_SCALE_PROMPT = """\
You are an OCR + measurement-extraction assistant for blueprints and
construction photos. Your ONLY job: find a dimension that can be used
to calibrate the image's scale.

PRIORITY 1 — Find a printed wall dimension with an arrow / extension
lines (e.g. '30'-0"' or '40'-6"' marking the length of a wall on the
elevation or floor plan). Return the pixel coordinates of the TWO
endpoints of the dimension line (where the arrow tips sit) PLUS the
labeled real-world value in feet.

PRIORITY 2 — If no labeled dimension is visible, find the scale block
(e.g. 'SCALE: 1/4" = 1'-0"') and return it as a fallback.

The image you receive is RENDERED AT THE NATURAL PIXEL DIMENSIONS you
see. Return pixel coordinates in that same coordinate system (origin
at top-left, x right, y down).

Return JSON ONLY (no prose, no markdown fences). Schema:
{
  "found":           true | false,
  "method":          "dimension_line" | "scale_block" | "none",
  "px_height":       number (Euclidean px distance between endpoints; 0 if not found),
  "real_ft":         number (labeled real-world distance in ft),
  "source":          "<short description of what you found, e.g. '30 ft front wall dimension' or 'SCALE 1/4\\" = 1\\\\'-0\\"' block'>",
  "confidence":      "high" | "medium" | "low",
  "endpoints":       [{"x": number, "y": number}, {"x": number, "y": number}],   // empty array if not found
  "notes":           "<one sentence on anything unusual or empty>"
}

If you can't find ANY reliable dimension, return `{"found": false, "method": "none", "confidence": "low", "notes": "<why>"}`.
"""


@router.post("/ocr-scale")
async def ocr_scale(
    payload: dict,
    user: dict = Depends(get_current_user),
):
    """Iter 78z+ — Auto-detect the scale on a blueprint page or photo.

    Body: `{"upload_name": "bp_xxxxxxxx.png"}` — the filename returned
    from the blueprint launch endpoint (or any /api/uploads/* filename).
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be an object")
    upload_name = (payload.get("upload_name") or "").strip()
    if not upload_name:
        raise HTTPException(status_code=400, detail="missing 'upload_name'")
    # Defense in depth — no path traversal.
    if "/" in upload_name or ".." in upload_name:
        raise HTTPException(status_code=400, detail="invalid upload_name")

    from config import UPLOAD_DIR
    target = UPLOAD_DIR / upload_name
    if not target.exists():
        raise HTTPException(status_code=404, detail="upload not found on disk")
    raw = target.read_bytes()
    if not raw:
        raise HTTPException(status_code=400, detail="upload is empty")

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY missing on server")

    # Compress through the same pipeline Claude already uses elsewhere.
    img_bytes = _compress_for_claude(raw)
    user_id = user.get("id") or "anon"
    session_id = f"ai-ocr-scale-{user_id}-{uuid.uuid4().hex[:8]}"
    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=OCR_SCALE_PROMPT,
    ).with_model("anthropic", MODEL_NAME)
    image_contents = [
        ImageContent(image_base64=base64.b64encode(img_bytes).decode("ascii")),
    ]
    try:
        reply_text = await chat.send_message(
            UserMessage(
                text="Find the calibration dimension on this image and return your JSON.",
                file_contents=image_contents,
            ),
        )
        parsed = _json_from_reply(reply_text or "")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[ocr-scale] Claude call failed for %s", upload_name)
        raise HTTPException(status_code=502, detail=f"OCR scale pass failed: {e}") from e

    # Sanity-check the response shape and derive px_height from endpoints
    # when Claude didn't compute it.
    endpoints = parsed.get("endpoints") or []
    px_height = 0.0
    try:
        px_height = float(parsed.get("px_height") or 0)
    except (TypeError, ValueError):
        px_height = 0.0
    if px_height <= 0 and len(endpoints) == 2:
        try:
            import math as _math
            dx = float(endpoints[0]["x"]) - float(endpoints[1]["x"])
            dy = float(endpoints[0]["y"]) - float(endpoints[1]["y"])
            px_height = _math.sqrt(dx * dx + dy * dy)
        except (KeyError, TypeError, ValueError):
            px_height = 0.0

    try:
        real_ft = float(parsed.get("real_ft") or 0)
    except (TypeError, ValueError):
        real_ft = 0.0

    found = bool(parsed.get("found")) and px_height > 0 and real_ft > 0
    return {
        "found":      found,
        "method":     parsed.get("method") or ("none" if not found else "dimension_line"),
        "px_height":  round(px_height, 2),
        "real_ft":    real_ft,
        "source":     parsed.get("source") or "",
        "confidence": parsed.get("confidence") or "low",
        "endpoints":  endpoints,
        "notes":      parsed.get("notes") or "",
    }
