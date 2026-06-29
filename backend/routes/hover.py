"""HOVER measurement report importer.

Flow:
1. Contractor uploads a HOVER PDF (multi-page measurement report).
2. We extract the plain text with pdfplumber — the PDFs are
   text-based, not scans, so this is fast and accurate.
3. The extracted text is sent to Claude Sonnet 4.5 with a strict JSON-output
   prompt that pulls every measurement we need (areas, counts, lengths).
4. Backend maps those measurements to catalog line items using
   industry-standard waste/coverage ratios and returns a draft `lines[]`
   payload the frontend can preview + commit.

Why text extraction first instead of sending the PDF binary to the LLM:
- `FileContentWithMimeType` in emergentintegrations only works with Gemini.
- HOVER PDFs are pure text (no scanned images we need to OCR).
- Sending ~40KB of text is ~10x cheaper + faster than the binary.

Constants live in this file so Howard can tune them without me touching code.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Optional

import pdfplumber
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from deps import get_current_user
import lp_smartside_formulas as lp_formulas

# Iter 78q — Phase 3 Deep Verify uses MongoDB to cache rendered elevation
# page PNGs. The TTL index purges entries 1 hour after creation so we
# never accumulate stale render data.
try:
    from services import db
except Exception:  # pragma: no cover — defensive at import time
    db = None


# -----------------------------------------------------------------------------
# Window-style guessing — HOVER reports DON'T tell us if a window is DH vs
# slider vs casement. They only give the rough opening (W × H). These rules
# pick the most likely Vero product type from those two numbers. Contractors
# can override per opening in the preview modal before applying.
#
# Rules apply in order — first match wins. Tuned to Howard's real-world bias:
# 99% of replacement openings end up as Double Hung; we only switch when
# dimensions strongly indicate otherwise.
# -----------------------------------------------------------------------------
def _guess_vero_product_type(width_in: float, height_in: float) -> str:
    """Heuristic to pick a Vero product type from rough opening dims.

    Iter 78y (2026-02-13): Vero collapsed to 3 product types: Double Hung,
    2-Lite Slider, Patio Door. Casement / 3-Lite Slider / Picture were
    dropped — small narrow windows now classify as DH, wide windows as
    2-Lite Slider. Patio Door is reserved for explicit door classification
    upstream (HOVER labels), never inferred from dims here.
    """
    try:
        w = float(width_in or 0)
        h = float(height_in or 0)
    except (TypeError, ValueError):
        return "Vero Double Hung"
    if w <= 0 or h <= 0:
        return "Vero Double Hung"
    # Wider than tall + at least 40" wide → 2-Lite Slider
    if w >= 40 and w > h:
        return "Vero 2-Lite Slider"
    # Everything else defaults to DH (small, tall, or narrow)
    return "Vero Double Hung"
    w = float(width_in or 0)
    h = float(height_in or 0)
    if w <= 0 or h <= 0:
        return "Vero Double Hung"

    # Iter 78y — Casement product type removed. Tight small openings
    # (kitchen above-sink, bath transom) now classify as DH per Howard's
    # bias for replacements. 3-Lite Slider + Picture were also removed —
    # very wide AND square landscape windows now route to 2-Lite Slider.
    # 2-Lite slider (XO) = wide AND landscape orientation
    if w >= 40 and w > h:
        return "Vero 2-Lite Slider"
    # Default everything else to DH (matches Howard's 99% bias for replacements)
    return "Vero Double Hung"


# Vero → Mezzo product type map. Iter 78y — Vero collapsed to 3 active
# product types (DH / 2-Lite Slider / Patio Door). The historical
# Casement/3-Lite/Picture keys remain here as a safety net so any saved
# vero_opening carrying one of those legacy types gets mapped to a
# still-valid Mezzo equivalent during snapshot reconcile.
_VERO_TO_MEZZO = {
    "Vero Double Hung":      "Mezzo Double Hung",
    "Vero 2-Lite Slider":    "Mezzo 2-Lite Slider",
    # Legacy fallbacks (Vero types no longer offered):
    "Vero 3-Lite Slider":    "Mezzo 2-Lite Slider",
    "Vero Picture":          "Mezzo Double Hung",
    "Vero 1-Lite Casement":  "Mezzo Double Hung",
}


def _vero_to_mezzo_product_type(vero_type: str) -> str:
    return _VERO_TO_MEZZO.get(vero_type, "Mezzo Double Hung")

load_dotenv()

router = APIRouter()
logger = logging.getLogger("estimator.hover")

DEFAULT_WASTE_PCT = 10.0  # Howard's preferred default per setup

# -----------------------------------------------------------------------------
# Catalog mapping
# -----------------------------------------------------------------------------
# Map HOVER measurements → catalog line items. Each entry now declares which
# *tab(s)* it targets (vinyl / ascend / lp_smart) so a single HOVER upload
# auto-populates all three parallel option sets — the contractor lands with
# three complete quotes ready to compare.
#
# Industry-standard ratios are documented inline so Howard can tune them.

# Typical opening perimeters used to back out window+patio-door perimeter
# from HOVER's lumped `opening_perimeter_lf` (HOVER doesn't break it out).
ENTRY_DOOR_PERIM_LF = 19.0    # 6'8" × 3'0" → 2 × (6.67 + 3.0) ≈ 19.3
GARAGE_DOOR_PERIM_LF = 32.0   # 9'0" × 7'0" → 2 × (9 + 7) = 32
PATIO_DOOR_PERIM_LF = 22.0    # 6'0" × 6'8" → 2 × (6 + 6.67) ≈ 25.3 (use 22, panels share jambs)
WINDOW_PERIM_LF_FALLBACK = 14.0  # 3'0" × 4'0" typical replacement window → 14 perim


def _window_perim_total_lf(m: dict) -> float:
    """Total window perimeter (all 4 sides) across every window on the job.

    Prefers per-window dims from `windows[]` (most accurate); falls back to
    `window_count × WINDOW_PERIM_LF_FALLBACK` when HOVER didn't break out
    individual dimensions. Used by Finish Trim (Iter 78f — full window
    perimeter, not just sills).
    """
    windows = m.get("windows") or []
    if windows:
        perim_in = sum(
            2 * (float(w.get("width_in") or 0) + float(w.get("height_in") or 0))
            for w in windows
        )
        return perim_in / 12.0
    return float(m.get("window_count") or 0) * WINDOW_PERIM_LF_FALLBACK


def _finish_trim_pcs(m: dict) -> int:
    """Iter 78f — Finish Trim qty = ceil((Eaves + full window perimeter) ÷ 12.5).
    Rakes are deliberately excluded: Soffit J-Channel already covers the rake
    in 2 passes (wall + fascia side), and Howard's install rule is exactly
    2 passes at each rake total — adding rake here would push it to 4."""
    eaves = float(m.get("eaves_lf") or 0)
    win_perim = _window_perim_total_lf(m)
    return max(0, math.ceil((eaves + win_perim) / 12.5))


def _finish_trim_note(m: dict) -> str:
    eaves = float(m.get("eaves_lf") or 0)
    win_perim = _window_perim_total_lf(m)
    windows = m.get("windows") or []
    src = (f"{len(windows)} windows individual dims"
           if windows else
           f"{int(m.get('window_count') or 0)} wins × {int(WINDOW_PERIM_LF_FALLBACK)} LF (fallback)")
    total = eaves + win_perim
    pcs = max(0, math.ceil(total / 12.5))
    return (f"{eaves:.0f} eaves + {win_perim:.0f} LF window perim "
            f"({src}) = {total:.0f} LF ÷ 12.5 = {pcs} pcs")


# Iter 78h — per-job breakdown strings for the 3 downspout-derived gutter
# rows so the Takeoff Recon Card can surface the math (1/25 LF rule, min 2,
# 10 LF/downspout, 2 elbows/downspout). Mirrors the J-channel pattern.
def _downspout_count(m: dict) -> int:
    eaves = float(m.get("eaves_lf") or 0)
    if eaves <= 0:
        return 0
    return max(2, math.ceil(eaves / 25))


# Iter 78z (P1.4) — Story-aware downspout drop length.
# A downspout's vertical drop ≈ eave height + 2 ft kick-out + 1 ft slack.
# For 1-story homes (~9 ft eave) drop ≈ 12 LF; for 2-story (~18 ft eave)
# drop ≈ 21 LF. The previous flat 10 LF/downspout assumption
# under-counted 2-story homes by >2x, which is exactly what Howard
# called out on his LETRICK reconciliation. Source priority for height:
#   1. `_ai_avg_wall_height_ft` (AI Measure / Blueprint vision-extracted)
#   2. fallback by `_ai_story_count`: 1 → 9 ft, 2 → 18 ft, 3 → 27 ft
#   3. final fallback: 9 ft (single-story baseline)
def _downspout_drop_ft(m: dict) -> float:
    h = float(m.get("_ai_avg_wall_height_ft") or 0)
    if h <= 0:
        s = int(m.get("_ai_story_count") or 1) or 1
        h = max(1, s) * 9.0
    return h + 3.0  # +2 ft kick + 1 ft slack


def _downspout_lf(m: dict) -> int:
    """Total downspout coil LF for the job (count × per-drop)."""
    n = _downspout_count(m)
    return int(round(n * _downspout_drop_ft(m)))


def _downspout_breakdown(m: dict) -> str:
    eaves = float(m.get("eaves_lf") or 0)
    if eaves <= 0:
        return "No eaves → 0 downspouts"
    raw = eaves / 25
    n = _downspout_count(m)
    drop = _downspout_drop_ft(m)
    total_lf = _downspout_lf(m)
    min_hit = " (min 2)" if n == 2 and raw < 2 else ""
    return (f"{eaves:.0f} LF eaves ÷ 25 = {raw:.1f} → ceil = "
            f"{n} downspouts{min_hit} × {drop:.0f} LF drop = {total_lf} LF coil")


def _elbow_breakdown(m: dict) -> str:
    eaves = float(m.get("eaves_lf") or 0)
    if eaves <= 0:
        return "No eaves → 0 elbows"
    raw = eaves / 25
    n = _downspout_count(m)
    min_hit = " (min 2)" if n == 2 and raw < 2 else ""
    return (f"{eaves:.0f} LF eaves ÷ 25 = {raw:.1f} → {n} downspouts{min_hit} "
            f"× 2 elbows (top turn + kick-out) = {n * 2} elbows")


# Iter 78i — Hangers with screws. Howard's install rule: 1 hanger per 2 ft
# of gutter + 1 per gutter run (run count mirrors the End-Cap estimate).
def _gutter_run_count(m: dict) -> int:
    eaves = float(m.get("eaves_lf") or 0)
    if eaves <= 0:
        return 0
    return max(2, math.ceil(eaves / 30))


def _hangers_count(m: dict) -> int:
    eaves = float(m.get("eaves_lf") or 0)
    if eaves <= 0:
        return 0
    spaced = math.ceil(eaves / 2)
    runs = _gutter_run_count(m)
    return spaced + runs


def _hangers_breakdown(m: dict) -> str:
    eaves = float(m.get("eaves_lf") or 0)
    if eaves <= 0:
        return "No eaves → 0 hangers"
    spaced = math.ceil(eaves / 2)
    runs = _gutter_run_count(m)
    return (f"{eaves:.0f} LF ÷ 2 ft spacing = {spaced} + {runs} runs "
            f"(1 per run) = {spaced + runs} hangers")


# Iter 78z (P1.4) — Gutter geometry: mitres, pipe clips, sealant.
#
# Mitre count = number of outside (or inside) corners the gutter run
# wraps. We infer roof type from AI walls: any gable wall present
# means the gutter doesn't wrap (typical 2-run front+back layout, 0
# mitres). On a pure hip roof every elevation flows water into the
# gutter so the gutter wraps the full perimeter — 4 mitres for a basic
# rectangular footprint, +1 per additional outside corner. We pull
# corner count from `outside_corner_lf / avg_wall_height` (rounded).
# Inside corners (re-entrant L-shaped footprints) add inside mitres
# 1:1 with `inside_corner_lf / avg_wall_height`.
def _has_gable_wall(m: dict) -> bool:
    """True when at least one wall in the per-elevation breakdown was
    flagged as a gable (gable_sqft > 0). Falls back to `_ai_gable_sqft`
    aggregate when the per-elevation grid isn't available."""
    per_elev = m.get("_per_elevation_breakdown") or []
    if isinstance(per_elev, list):
        for e in per_elev:
            if float(e.get("gable_sqft") or 0) > 0:
                return True
    return float(m.get("_ai_gable_sqft") or 0) > 0


def _gutter_corner_count(m: dict) -> tuple[int, int]:
    """Returns (outside_corners, inside_corners) of the gutter run.

    Outside corners drive ROOFLINE mitres. Inside corners (re-entrant
    L-shaped footprints) also drive mitres 1:1.
    """
    h = float(m.get("_ai_avg_wall_height_ft") or 0)
    if h <= 0:
        h = 9.0  # single-story baseline
    out_lf = float(m.get("outside_corner_lf") or 0)
    in_lf = float(m.get("inside_corner_lf") or 0)
    out_n = round(out_lf / h) if h > 0 else 0
    in_n = round(in_lf / h) if h > 0 else 0
    return max(0, out_n), max(0, in_n)


def _mitre_count(m: dict) -> int:
    if float(m.get("eaves_lf") or 0) <= 0:
        return 0
    out_n, in_n = _gutter_corner_count(m)
    # Gable house: gutter doesn't wrap → 0 outside mitres. Inside
    # corners (porches / L-shapes) still get a mitre because the gutter
    # has to follow the re-entrant fascia.
    if _has_gable_wall(m):
        return in_n
    # Pure hip roof: gutter wraps → mitres at every outside + inside corner.
    return out_n + in_n


def _mitre_breakdown(m: dict) -> str:
    if float(m.get("eaves_lf") or 0) <= 0:
        return "No eaves → 0 mitres"
    out_n, in_n = _gutter_corner_count(m)
    gable = _has_gable_wall(m)
    n = _mitre_count(m)
    if gable:
        return (f"Gable roof — gutter doesn't wrap. "
                f"Outside corners ({out_n}) skipped; inside corners {in_n} → {n} mitres")
    return (f"Hip roof — gutter wraps. "
            f"Outside {out_n} + inside {in_n} = {n} mitres")


# Pipe Clips: 1 clip per 6 ft of downspout drop (industry standard).
# Most installs use 2 clips per single-story drop (~12 LF / 6 = 2),
# 4 clips per 2-story drop. Each clip secures the downspout to the
# wall against wind load.
def _pipe_clips_count(m: dict) -> int:
    n_down = _downspout_count(m)
    if n_down <= 0:
        return 0
    drop = _downspout_drop_ft(m)
    per_down = max(2, math.ceil(drop / 6))
    return n_down * per_down


def _pipe_clips_breakdown(m: dict) -> str:
    n_down = _downspout_count(m)
    if n_down <= 0:
        return "No downspouts → 0 pipe clips"
    drop = _downspout_drop_ft(m)
    per_down = max(2, math.ceil(drop / 6))
    total = n_down * per_down
    return (f"{n_down} downspouts × {per_down} clips ({drop:.0f} LF drop ÷ 6) "
            f"= {total} clips")


# Gutter Sealant: 1 tube per 4 connection points. Connection points =
# every mitre + every end cap + every outlet (1 outlet per downspout).
# A standard 10 oz tube covers ~16-20 ft of joint, and each connection
# uses ~4-5 ft. Howard's job-cost rule of thumb: 1 tube per 4 joints.
def _sealant_count(m: dict) -> int:
    if float(m.get("eaves_lf") or 0) <= 0:
        return 0
    mitres = _mitre_count(m)
    runs = _gutter_run_count(m)
    end_caps = runs * 2
    outlets = _downspout_count(m)
    joints = mitres + end_caps + outlets
    return max(1, math.ceil(joints / 4)) if joints > 0 else 0


def _sealant_breakdown(m: dict) -> str:
    if float(m.get("eaves_lf") or 0) <= 0:
        return "No eaves → 0 sealant tubes"
    mitres = _mitre_count(m)
    runs = _gutter_run_count(m)
    end_caps = runs * 2
    outlets = _downspout_count(m)
    joints = mitres + end_caps + outlets
    n = _sealant_count(m)
    return (f"{mitres} mitres + {end_caps} end caps + {outlets} outlets "
            f"= {joints} joints ÷ 4 = {n} tubes")


def _j_channel_pcs(m: dict) -> int:
    """See `_j_channel_breakdown` for the full math + which source path
    was used. This wrapper just returns the integer piece count."""
    pcs, _ = _j_channel_compute(m)
    return pcs


def _j_channel_breakdown(m: dict) -> str:
    """Iter 57ee — Human-readable breakdown of the J-channel calc shown
    in the HOVER/blueprint preview. Example output:
        "5 wins × 14 + 1 patio × 22 + 2 garage × 32 + 100 eaves + 140 rakes = 326 LF ÷ 12.5 = 27 pcs"
    or when HOVER provided real per-window dims:
        "windows = 77 LF (5 individual dims) + 1 patio × 22 + 2 garage × 32 + 100 eaves + 140 rakes = 333 LF ÷ 12.5 = 27 pcs"
    """
    _, br = _j_channel_compute(m)
    return br


def _j_channel_compute(m: dict) -> tuple[int, str]:
    """Howard's J-channel formula (Iter 78 — eaves moved to Finish Trim):

        pcs = ceil( (window + patio + garage perimeter + rakes) / 12.5 )

    Eaves used to be added here, but that double-counted the eave run
    against Finish Trim (which already includes eaves). Eaves now belong
    exclusively to Finish Trim; J-channel covers openings + rake
    terminations only.

    Garage doors are now INCLUDED in the J-channel count (most
    contractors wrap vinyl J around the garage opening even with a
    brickmould surround, since the head + jambs still receive panels).

    Window+patio perimeter is computed best-signal-first:
      1) Sum actual perimeters from `windows[]` (individual dims) if
         HOVER extracted them. Most reliable.
      2) Else: use HOVER's lumped `opening_perimeter_lf` minus the
         entry-door + garage-door allowances (garage gets added back).
      3) Else: count-based estimate (window_count × 14 + patio × 22).
         Safety net for HOVER reports that don't print the opening
         perimeter at all.

    Returns (pcs, breakdown_string).
    """
    entry_n = float(m.get("entry_door_count") or 0)
    garage_n = float(m.get("garage_door_count") or 0)
    patio_n = float(m.get("patio_door_count") or 0)
    win_count = float(m.get("window_count") or 0)
    opening_perim = float(m.get("opening_perimeter_lf") or 0)
    windows = m.get("windows") or []
    rakes = float(m.get("rakes_lf") or 0)

    parts: list[str] = []  # human-readable breakdown segments
    if windows:
        win_perim_in = sum(
            2 * (float(w.get("width_in") or 0) + float(w.get("height_in") or 0))
            for w in windows
        )
        win_lf = win_perim_in / 12.0
        win_patio_perim = win_lf + (patio_n * PATIO_DOOR_PERIM_LF)
        parts.append(f"windows = {win_lf:.1f} LF ({len(windows)} individual dims)")
        if patio_n:
            parts.append(f"{int(patio_n)} patio × {int(PATIO_DOOR_PERIM_LF)}")
    elif opening_perim > 0:
        win_patio_perim = max(
            0.0,
            opening_perim
            - entry_n * ENTRY_DOOR_PERIM_LF
            - garage_n * GARAGE_DOOR_PERIM_LF,
        )
        sub_str = f"{opening_perim:.0f} HOVER perim"
        if entry_n:
            sub_str += f" − {int(entry_n)} entry × {int(ENTRY_DOOR_PERIM_LF)}"
        if garage_n:
            sub_str += f" − {int(garage_n)} garage × {int(GARAGE_DOOR_PERIM_LF)}"
        parts.append(f"({sub_str}) = {win_patio_perim:.0f} LF window+patio")
    else:
        win_patio_perim = (
            win_count * WINDOW_PERIM_LF_FALLBACK
            + patio_n * PATIO_DOOR_PERIM_LF
        )
        parts.append(f"{int(win_count)} wins × {int(WINDOW_PERIM_LF_FALLBACK)}")
        if patio_n:
            parts.append(f"{int(patio_n)} patio × {int(PATIO_DOOR_PERIM_LF)}")
    if garage_n:
        parts.append(f"{int(garage_n)} garage × {int(GARAGE_DOOR_PERIM_LF)}")
    if rakes:
        parts.append(f"{rakes:.0f} rakes")

    total_lf = (
        win_patio_perim
        + garage_n * GARAGE_DOOR_PERIM_LF
        + rakes
    )
    if total_lf <= 0:
        return 0, "no openings + no rakes → 0 pcs"
    pcs = int(math.ceil(total_lf / 12.5))
    breakdown = f"{' + '.join(parts)} = {total_lf:.0f} LF ÷ 12.5 = {pcs} pcs"
    return pcs, breakdown


HOVER_MAPPING_SPEC = [
    # =====================================================================
    # HEADLINE SIDING — one per tab. We use HOVER's "+ Openings < 20ft²
    # +10%" row (from SIDING WASTE TOTALS) so the small-opening adder is
    # already baked in. Raw facades area is the fallback.
    #
    # Iter 78z (P1.2) — When measurements carry a multi-profile breakdown
    # (`_per_profile_sqft` has >1 family — Lap + Shake + B&B etc.), the
    # default single-SKU siding rows below are SKIPPED in `_build_lines`
    # and replaced with per-profile lines via `_profile_siding_lines()`.
    # The `_is_default_siding: True` marker tags these rows for that
    # skip logic. Single-profile (or no breakdown) houses still hit the
    # default mapping with the small-opening adder baked in.
    # =====================================================================
    {
        "tabs": ["vinyl"],
        "section": "Vinyl Siding",
        "item": "Charter Oak Standard color Dutch Lap 4.5\" .046",
        "unit": "SQ",
        "extract": lambda m: round(
            ((m.get("siding_with_openings_sqft") or m.get("siding_sqft") or 0)) / 100.0,
            1,
        ),
        "note": "From HOVER 'SIDING WASTE TOTALS → + Openings < 20ft² +10%'",
        "_is_default_siding": True,
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding",
        "item": "Ascend Composite Lap Siding 7\"",
        "unit": "SQ",
        "extract": lambda m: round(
            ((m.get("siding_with_openings_sqft") or m.get("siding_sqft") or 0)) / 100.0,
            1,
        ),
        "note": "Default Ascend profile — change via edit if needed",
        "_is_default_siding": True,
    },
    {
        "tabs": ["lp_smart"],
        "section": "LP Smart Siding",
        "item": '38 Series Lap 3/8" x 8" x 16\'',
        "unit": "PCS",
        "extract": lambda m: (
            # Iter 78ab — when LP_AI_FORMULAS_V1 is enabled, use the
            # PDF-accurate 8" Lap coverage (9.17 sqft/PCS) + 10% waste
            # + round-up. Otherwise keep the legacy `sqft × 0.11` math
            # (≈ 9.09 sqft/PCS, no explicit waste) so existing quotes
            # don't shift while we're staging.
            lp_formulas.lap_pieces(
                (m.get("siding_with_openings_sqft") or m.get("siding_sqft") or 0),
            )
            if lp_formulas.is_enabled()
            else max(
                1,
                round(((m.get("siding_with_openings_sqft") or m.get("siding_sqft") or 0)) * 0.11),
            )
        ),
        "note": lambda m: (
            f"LP 8\" Lap: ceil(sqft ÷ 9.17 × 1.10) — PDF coverage (LPZB0884)"
            if lp_formulas.is_enabled()
            else "11 PCS per Sq (LP 8\" lap exposure); sqft × 0.11 rounded"
        ),
        "_is_default_siding": True,
    },
    # Iter 68 (2026-06-22) — LP starter-pack auto-fill so HOVER imports
    # don't leave the LP tab empty. Note: 6" Lap is intentionally NOT
    # auto-filled — it's an ALTERNATIVE to 8" Lap, not additive. If the
    # contractor wants 6" instead, they zero out 8" and type the 6" qty
    # (or we can build a one-tap "swap to 6"" button later).
    # Iter 68a: 6" Lap auto-fill removed after Howard caught the double-
    # count in preview. Row stays in the catalog at $26.45 PCS (whole-sale)
    # but qty starts at 0.
    # 440 Series Trim 4/4" x 4" — inside corners + level/sloped runs
    # (Howard's formula: (eaves + rakes) ÷ 16).
    {
        "tabs": ["lp_smart"],
        "section": "LP SmartSide Trim",
        "item": '440 Series Trim 4/4" x 4" x 16\'',
        "unit": "PCS",
        "extract": lambda m: max(
            1,
            math.ceil(((m.get("eaves_lf") or 0) + (m.get("rakes_lf") or 0)) / 16),
        ),
        "note": "Inside corners + horizontal runs — (eaves + rakes) ÷ 16",
    },
    # 540 Series Trim 5/4" x 4" — window / entry door / patio / garage trim
    # wrap. Per-opening trim LF mirrors the J-channel formula divisors
    # Howard set in Iter 57ee: 14 ft per window, 21 ft per entry, 25 ft
    # per patio (sliding glass), 32 ft per garage door. Sum ÷ 16 (board).
    # Iter 78ab — when LP_AI_FORMULAS_V1 is enabled AND shakes appear in
    # the per-profile breakdown, add Howard's 540 belly-band bump per
    # LP PDF guidance ("recommends 540 Series for shake reveals 7"–10"").
    {
        "tabs": ["lp_smart"],
        "section": "LP SmartSide Trim",
        "item": '540 Series Trim 5/4" x 4" x 16\'',
        "unit": "PCS",
        "extract": lambda m: max(
            1,
            math.ceil((
                (m.get("window_count") or 0) * 14
                + (m.get("entry_door_count") or 0) * 21
                + (m.get("patio_door_count") or 0) * 25
                + (m.get("garage_door_count") or 0) * 32
            ) / 16) + (
                lp_formulas.shake_540_series_bump(
                    float((m.get("_per_profile_sqft") or {}).get("shake") or 0)
                )
                if lp_formulas.is_enabled()
                else 0
            ),
        ),
        "note": lambda m: (
            "Window/entry/patio/garage perimeter wrap ÷ 16 + "
            f"{lp_formulas.shake_540_series_bump(float((m.get('_per_profile_sqft') or {}).get('shake') or 0))} "
            "shake belly-band pcs (LP PDF)"
            if lp_formulas.is_enabled()
               and float((m.get("_per_profile_sqft") or {}).get("shake") or 0) > 0
            else "Window/entry/patio/garage perimeter wrap ÷ 16"
        ),
    },
    # Iter 78ab — 190 Series Trim 19/32" x 3" x 16' is LP's batten strip
    # SKU. Only fires when the AI/Blueprint pipeline returned a
    # board_batten breakdown AND the flag is on. PDF formula:
    #   batten_LF = wall_sqft × (LF_per_100sqft ÷ 100), default 16" o.c.
    #   pcs = ceil(batten_LF × 1.10 / 16)
    {
        "tabs": ["lp_smart"],
        "section": "LP SmartSide Trim",
        "item": '190 Series Trim 19/32" x 3" x 16\'',
        "unit": "PCS",
        "extract": lambda m: (
            lp_formulas.board_batten_batten_pieces(
                float((m.get("_per_profile_sqft") or {}).get("board_batten") or 0)
                + float((m.get("_per_profile_sqft") or {}).get("vertical") or 0),
            )
            if lp_formulas.is_enabled()
            else 0
        ),
        "note": "190 Series batten strips — wall_sqft × 0.75 LF/sqft ÷ 16 (PDF default 16\" o.c.)",
    },
    # .019 Coil — default 1 ROLL for flashing transitions (siding ↔ brick/
    # stone, kickout flashing, etc.). Contractor zeros it out on pure-
    # siding jobs with no flashing transitions.
    {
        "tabs": ["lp_smart"],
        "section": "LP Siding Accessories",
        "item": '.019 Coil',
        "unit": "ROLL",
        "extract": lambda m: 1,
        "note": "Default 1 roll — flashing transitions (stone ↔ siding, kickouts)",
    },
    # Touch up kits — 1 per job per color. We don't know the color count
    # from HOVER, so default 1 and let the contractor bump it if multi-
    # color.
    {
        "tabs": ["lp_smart"],
        "section": "LP Siding Accessories",
        "item": 'Touch up kits',
        "unit": "PCS",
        "extract": lambda m: 1,
        "note": "1 per color — bump if multi-color job",
    },
    # OSI Quad Max Caulking — 2 tubes per job (matches the vinyl
    # "Caulking (per color)" default Howard set in Iter 57m).
    {
        "tabs": ["lp_smart"],
        "section": "LP Siding Accessories",
        "item": 'OSI Quad Max Caulking',
        "unit": "Tube",
        "extract": lambda m: 2,
        "note": "Default 2 tubes per job",
    },
    # J blocks — small penetration cover plates (lights, outlets, hose
    # bibs, dryer vents). Scaled by openings as a rough house-size proxy
    # since HOVER doesn't list utility penetrations.
    {
        "tabs": ["lp_smart"],
        "section": "LP Siding Accessories",
        "item": 'J blocks',
        "unit": "Each",
        "extract": lambda m: max(
            4,
            round((m.get("window_count") or 0) / 6 + (m.get("door_count") or 0) / 2),
        ),
        "note": "Min 4 — lights, outlets, hose bibs scaled by openings",
    },
    # Mini Splits — large penetration covers (AC linesets, dryer vents,
    # range hoods). Most homes have 1-3.
    {
        "tabs": ["lp_smart"],
        "section": "LP Siding Accessories",
        "item": 'Mini Splits',
        "unit": "Each",
        "extract": lambda m: max(
            1,
            round((m.get("entry_door_count") or 0) / 2),
        ),
        "note": "Min 1 — AC linesets, dryer vents, range hoods",
    },
    # =====================================================================
    # OUTSIDE CORNERS — count is HOVER outside-corner LF ÷ piece length.
    # Vinyl/Ascend = 10' pieces, LP = 16' pieces.
    # =====================================================================
    {
        "tabs": ["vinyl"],
        "section": "Siding Accessories",
        "item": "Outside corners Standard color",
        "unit": "PCS",
        "extract": lambda m: max(1, math.ceil((m.get("outside_corner_lf") or 0) / 12.5)),
        "note": "Vinyl 12.5' outside-corner pieces (HOVER LF ÷ 12.5, round up)",
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "Ascend 5.5\" Outside Corner  - MATTE",
        "unit": "PCS",
        "extract": lambda m: max(1, math.ceil((m.get("outside_corner_lf") or 0) / 12.5)),
        "note": "Ascend 12.5' outside-corner pieces / corner LF",
    },
    {
        "tabs": ["lp_smart"],
        "section": "LP Siding Accessories",
        "item": "540 Series OSC 5/4\" x 4\" x 16'",
        "unit": "PCS",
        "extract": lambda m: max(1, round((m.get("outside_corner_lf") or 0) / 16)),
        "note": "LP 16' outside-corner pieces / corner LF",
    },
    # =====================================================================
    # INSIDE CORNERS — vinyl + ascend. LP doesn't ship a dedicated inside-
    # corner item (LP installers use trim/butt joints), so we skip LP here.
    # =====================================================================
    {
        "tabs": ["vinyl"],
        "section": "Siding Accessories",
        "item": "Inside Corners (Siding) Standard color",
        "unit": "PCS",
        "extract": lambda m: max(0, math.ceil((m.get("inside_corner_lf") or 0) / 12.5)),
        "note": "12.5' pieces per HOVER inside-corner LF, round up — defaults to Standard color",
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "Inside Corners",
        "unit": "PCS",
        "extract": lambda m: max(0, math.ceil((m.get("inside_corner_lf") or 0) / 12.5)),
        "note": "Ascend inside-corner 12.5' pieces / corner LF, round up",
    },
    # =====================================================================
    # STARTER — both vinyl and Ascend now per-PCS in the catalog. HOVER
    # qty = LF ÷ 10 (per Howard). LP has no dedicated starter.
    # =====================================================================
    {
        "tabs": ["vinyl"],
        "section": "Siding Accessories",
        "item": "Starter",
        "unit": "PCS",
        "extract": lambda m: max(0, math.ceil((m.get("starter_lf") or 0) / 12.5)),
        "note": "Vinyl Starter pcs = ceil(HOVER starter LF ÷ 12.5)",
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "Ascend - Starter",
        "unit": "PCS",
        "extract": lambda m: max(0, math.ceil((m.get("starter_lf") or 0) / 12.5)),
        "note": "Ascend Starter pcs = ceil(HOVER starter LF ÷ 12.5)",
    },
    # =====================================================================
    # FINISH TRIM — qty = (eaves LF + FULL window perimeter) ÷ 12.5
    # Iter 78f (2026-02-25): Howard's clarification — finish trim wraps the
    # full window perimeter (top + sides + bottom), not just the sill width.
    # Rakes are NOT included here: Soffit J-Channel already counts 2 passes
    # at each rake; total install rule is exactly 2 passes per rake.
    # =====================================================================
    {
        "tabs": ["vinyl"],
        "section": "Siding Accessories",
        "item": "Finish Trim Standard color",
        "unit": "PCS",
        "extract": lambda m: _finish_trim_pcs(m),
        "note": lambda m: _finish_trim_note(m),
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "ASCEND Finish Trim",
        "unit": "PCS",
        "extract": lambda m: _finish_trim_pcs(m),
        "note": lambda m: _finish_trim_note(m),
    },
    # =====================================================================
    # J-CHANNEL — wraps window + patio + GARAGE door perimeters PLUS soffit
    # eaves + rakes. HOVER lumps every opening together in
    # `opening_perimeter_lf`; we prefer the per-window dims from
    # `windows[]` when present, otherwise back out entry doors and fall
    # back to count-based estimates. LP doesn't use J-channel.
    # Pieces are 12.5 ft each, always round UP.
    # =====================================================================
    {
        "tabs": ["vinyl"],
        "section": "Siding Accessories",
        "item": "3/4\" J-Channel Standard color (2 per Sq of siding)",
        "unit": "PCS",
        "extract": lambda m: _j_channel_pcs(m),
        "note": lambda m: _j_channel_breakdown(m),
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "Ascend - J - Channel  (2 per Sq of siding)",
        "unit": "PCS",
        "extract": lambda m: _j_channel_pcs(m),
        "note": lambda m: _j_channel_breakdown(m),
    },
    # =====================================================================
    # .019 TRIM COIL — 1 roll per 5 squares of siding (per Howard). The
    # "Siding Accessories" section is shared across the Vinyl and Ascend
    # tabs, so one mapping with both tabs listed lands the qty on each.
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Siding Accessories",
        "item": ".019 Coil (1 per 5 Sq Siding)",
        "unit": "ROLL",
        "extract": lambda m: round(((m.get("siding_sqft") or 0) / 100.0) / 5, 2),
        "note": "Squares ÷ 5 (per Howard)",
    },
    # =====================================================================
    # WALL UNDERLAYMENT — vinyl gets House Wrap; Ascend gets RainDrop House
    # Wrap (the rainscreen underlayment Ascend installers prefer). LP has
    # no underlayment line in the catalog.
    # =====================================================================
    {
        "tabs": ["vinyl"],
        "section": "Siding Accessories",
        "item": "House Wrap",
        "unit": "SQ",
        "extract": lambda m: round(
            ((m.get("siding_with_openings_sqft") or m.get("siding_sqft") or 0)) / 100.0,
            1,
        ),
        "note": "Matches HOVER 'SIDING WASTE TOTALS → + Openings < 20ft² +10%'",
    },
    {
        "tabs": ["ascend"],
        "section": "Siding Accessories",
        "item": "RainDrop House Wrap",
        "unit": "SQ",
        "extract": lambda m: round(
            ((m.get("siding_with_openings_sqft") or m.get("siding_sqft") or 0)) / 100.0,
            1,
        ),
        "note": "Ascend rainscreen underlayment — same SQ as siding",
    },
    # =====================================================================
    # NAILS — vinyl + ascend; LP uses different fasteners (manual entry).
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Siding Accessories",
        "item": "2\" Nails 30 lbs (1 per 15 Sq)",
        "unit": "JOB",
        "extract": lambda m: max(1, round((m.get("siding_sqft") or 0) / 100.0 / 15)),
        "note": "1 box per 15 SQ of siding",
    },
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Siding Accessories",
        "item": "1 1/4\" Trim Nails",
        "unit": "Box",
        "extract": lambda m: 1,
        "note": "1 box per job (standard)",
    },
    # =====================================================================
    # SOFFIT — vinyl + ascend share the soffit line; LP has its own
    # panel-based soffit. Iter 45: switched LF → PCS using Howard's
    # formula: Pieces = (Overhang × Length) ÷ ((Exposure/12) × Panel length)
    # Charter Oak default uses 10"-exposure × 12' panel = 10 sqft/pc;
    # overhang is read from the estimate (defaults to 12" if absent).
    # Length = eaves + rakes since soffit wraps both the level eave and
    # the gable rake undersides. Waste% is left for the Waste Factor
    # card downstream so we don't double-apply.
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Vinyl Soffit with Siding",
        "item": "Charter Oak Soffit Standard color",
        "unit": "PCS",
        "extract": lambda m: max(
            0,
            math.ceil(
                ((float(m.get("overhang_in") or 12) / 12.0)
                 * ((m.get("eaves_lf") or 0) + (m.get("rakes_lf") or 0)))
                / 10.0
            ),
        ),
        "note": "Pieces = (Overhang × (Eaves+Rakes)) ÷ panel area (10 sqft/pc); Standard color default",
    },
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Vinyl Soffit with Siding",
        "item": "3/4\" Soffit J-Channel (Charter Oak) Standard color",
        "unit": "PCS",
        "extract": lambda m: max(
            0,
            math.ceil(((m.get("eaves_lf") or 0) + 2 * (m.get("rakes_lf") or 0)) / 12.5),
        ),
        "note": "(Eaves + 2 × Rakes) ÷ 12.5 LF/stick — soffit J runs 2 passes at each rake (wall side + fascia return)",
    },
    # =====================================================================
    # FASCIA / RAKE / FRIEZE COVERAGE — driven off eaves LF (per Howard).
    # Lives in the shared "Vinyl Soffit with Siding" section so one mapping
    # lands the qty on both Vinyl and Ascend tabs.
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Vinyl Soffit with Siding",
        "item": 'Fascia/rake or frieze up to 8" coverage',
        "unit": "LF",
        "extract": lambda m: round((m.get("eaves_lf") or 0) + (m.get("rakes_lf") or 0)),
        "note": "Eaves LF + Rakes LF (fascia wraps both eave runs and gable rakes)",
    },
    # =====================================================================
    # .019 FASCIA COIL — 1 roll per 100 LF of soffit/fascia (per Howard).
    # Soffit/fascia LF = eaves LF + rakes LF.
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Vinyl Soffit with Siding",
        "item": ".019 Coil (1 per 50' fascia)",
        "unit": "ROLL",
        "extract": lambda m: round(
            ((m.get("eaves_lf") or 0) + (m.get("rakes_lf") or 0)) / 100, 2
        ),
        "note": "Soffit & fascia LF ÷ 100 (per Howard)",
    },
    # =====================================================================
    # CAULKING — flat default of 2 tubes per job regardless of size (per
    # Howard). Contractor can bump it up on bigger jobs.
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Siding Accessories",
        "item": "Caulking (per color)",
        "unit": "EA",
        "extract": lambda m: 2,
        "note": "Default 2 tubes per job (per Howard)",
    },
    # Iter 70 (2026-06-22): wire HOVER fields previously left on the floor.
    # Gable Vents — auto-populate from HOVER's Accessories → Vents Qty.
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Siding Accessories",
        "item": "Gable vents (round,octagon)",
        "unit": "Each",
        "extract": lambda m: int(m.get("vent_count") or 0),
        "note": "HOVER Accessories → Vents Qty",
    },
    # Shutters — HOVER reports total individual shutters; catalog row is
    # priced per PAIR, so divide by 2 (round up so a stray single still
    # gets a pair quoted).
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Siding Accessories",
        "item": "Shutters (louvered, raised panel) standard sizes",
        "unit": "PR",
        "extract": lambda m: math.ceil((m.get("shutter_count") or 0) / 2),
        "note": "HOVER shutter qty ÷ 2 (catalog priced per pair)",
    },
    # Second/Third/Clear Story Fee — flat $1,846 labor adder on Windows
    # tab when HOVER reports the home is >1 story. Stories field is a
    # string ("1", "2", ">1"); we treat anything not equal to "1" and
    # not blank as multi-story.
    {
        "tabs": ["windows"],
        "section": "Window Misc.",
        "item": "Second/Third/Clear Story Fee",
        "unit": "each",
        "extract": lambda m: 1 if (
            str(m.get("stories") or "1").strip() not in ("1", "", "None", "null")
        ) else 0,
        "note": "HOVER stories > 1 → 1 fee applies",
    },
    # Iter 68 (2026-06-22): split soffit Vented vs Closed by eaves/rakes.
    # Convention: VENTED soffit goes on EAVES (allows attic ventilation),
    # CLOSED/SOLID soffit goes on RAKES (no venting needed at gables).
    # Howard's request — splits the previous (eaves+rakes)/16 lump into
    # the two right material rows so the contractor doesn't have to move
    # qty between them by hand.
    {
        "tabs": ["lp_smart"],
        "section": "LP SmartSide Soffit",
        "item": "38 Series Soffit 16 x 16 Vented",
        "unit": "PCS",
        "extract": lambda m: max(
            1, math.ceil((m.get("eaves_lf") or 0) / 16)
        ),
        "note": "Vented goes on eaves (attic vent path) — eaves LF ÷ 16",
    },
    {
        "tabs": ["lp_smart"],
        "section": "LP SmartSide Soffit",
        "item": "38 Series Soffit 16 x 16 Closed",
        "unit": "PCS",
        "extract": lambda m: max(
            1, math.ceil((m.get("rakes_lf") or 0) / 16)
        ) if (m.get("rakes_lf") or 0) > 0 else 0,
        "note": "Closed goes on rakes (gable ends, no venting) — rakes LF ÷ 16",
    },
    # =====================================================================
    # GUTTER — all 3 tabs share the Seamless Gutter section.
    # Iter 78 (2026-02-23): tightened downspout + end-cap formulas per
    # Howard's LETRICK reconciliation. Downspouts: 1 per 25 LF (was 30).
    # End caps: 1 run per 30 LF eaves (was 40).
    #   - 2 elbows per downspout (1 top to turn off the gutter, 1 kick-out
    #     at the bottom to throw water away from the foundation)
    #   - Minimum 2 downspouts when ANY gutter is present (code-typical:
    #     a house needs at least one on each end). When eaves_lf is 0
    #     (e.g. a side-elevation-only quote), all three rows extract to 0
    #     and the line items get suppressed by the zero-qty filter.
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Seamless Gutter",
        "item": "Gutter 6\"",
        "unit": "LF",
        "extract": lambda m: round(m.get("eaves_lf") or 0),
        "note": "Eaves LF (gutters run along eaves, not rakes)",
    },
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Seamless Gutter",
        "item": "Downspout 6\"",
        "unit": "LF",
        # Iter 78z (P1.4): story-aware drop length. 1 downspout per 25 LF
        # eaves (min 2), drop = avg_wall_height + 3 ft (kick + slack).
        # 1-story → ~12 LF/drop, 2-story → ~21 LF/drop. Previous flat 10 LF
        # under-counted 2-story by 2x per Howard's LETRICK reconciliation.
        "extract": lambda m: _downspout_lf(m),
        # Iter 78h — surface the per-job math so Howard can spot drift.
        "note": lambda m: _downspout_breakdown(m),
    },
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Seamless Gutter",
        "item": "elbow",
        "unit": "Each",
        # 2 elbows per downspout (top turn + bottom kick-out). Same
        # 1-per-25 LF rule as downspouts.
        "extract": lambda m: (
            max(2, math.ceil((m.get("eaves_lf") or 0) / 25)) * 2
            if (m.get("eaves_lf") or 0) > 0 else 0
        ),
        "note": lambda m: _elbow_breakdown(m),
    },
    # Iter 65 — End Caps. Industry standard: 2 caps per continuous gutter
    # run (one on each end). HOVER doesn't expose a gutter-run count so
    # we estimate runs from eaves LF: a typical rectangular home has
    # ~2 runs (front + back), larger/wrapping homes get +1 run per ~30
    # LF (tightened from 40 in Iter 78 per LETRICK reconciliation).
    # Min 2 runs whenever any gutter is present.
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Seamless Gutter",
        "item": "End Cap",
        "unit": "Each",
        "extract": lambda m: (
            max(2, math.ceil((m.get("eaves_lf") or 0) / 30)) * 2
            if (m.get("eaves_lf") or 0) > 0 else 0
        ),
        "note": "2 end caps per gutter run (~1 run per 30 LF eaves, min 2 runs)",
    },
    # Iter 78i — Hangars with Screws. Howard's install rule: 1 hanger every
    # 2 ft of gutter PLUS 1 extra per gutter run (for the end termination).
    # Run count reuses the End-Cap estimate (max(2, ceil(eaves/30))) so the
    # two formulas stay in sync. Shared across vinyl/ascend/LP siding tabs;
    # available on AI Measure + HOVER + Blueprint via the shared
    # `_build_lines` mapper.
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Seamless Gutter",
        "item": "Hangars with Screws",
        "unit": "Each",
        "extract": lambda m: _hangers_count(m),
        "note": lambda m: _hangers_breakdown(m),
    },
    # Iter 78z (P1.4) — Mitre auto-fill. Inferred from roof type
    # (gable vs hip) + corner counts. Gable houses get 0 outside mitres
    # because the gutter doesn't wrap; hip roofs get a mitre at every
    # outside + inside corner. Inside corners (L-shaped footprints) get
    # a mitre regardless of roof type. See `_mitre_count` for the full
    # math + `_mitre_breakdown` for the human-readable formula chip.
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Seamless Gutter",
        "item": "Mitre",
        "unit": "Each",
        "extract": lambda m: _mitre_count(m),
        "note": lambda m: _mitre_breakdown(m),
    },
    # Iter 78z (P1.4) — Pipe Clips auto-fill. Industry standard: 1 clip
    # per 6 ft of downspout drop, minimum 2 per downspout. Scales
    # correctly with story count via `_downspout_drop_ft`.
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Seamless Gutter",
        "item": "Pipe Clips",
        "unit": "Each",
        "extract": lambda m: _pipe_clips_count(m),
        "note": lambda m: _pipe_clips_breakdown(m),
    },
    # Iter 78z (P1.4) — Gutter Sealant auto-fill. 1 tube per 4 joint
    # points (mitre + end cap + outlet). Howard's job-cost rule of thumb.
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Seamless Gutter",
        "item": "Gutter Sealant",
        "unit": "Each",
        "extract": lambda m: _sealant_count(m),
        "note": lambda m: _sealant_breakdown(m),
    },
    # Iter 57w — Mirror Gutter + Downspout into the ISS catalog. ISS uses
    # the "Seamless Gutter with Siding" section with plainer item names
    # ("Gutter" / "Downspout"), so they need their own spec entries. ISS
    # has no separate "elbow" line in the catalog so we don't emit it
    # there. (Re-siding jobs are the typical ISS use case — "with
    # Siding" matches the "without Siding" exception is non-default.)
    {
        "tabs": ["iss"],
        "section": "Seamless Gutter with Siding",
        "item": "Gutter",
        "unit": "LF",
        "extract": lambda m: round(m.get("eaves_lf") or 0),
        "note": "Eaves LF (gutters run along eaves, not rakes)",
    },
    {
        "tabs": ["iss"],
        "section": "Seamless Gutter with Siding",
        "item": "Downspout",
        "unit": "LF",
        # Iter 78z (P1.4): story-aware drop, same formula as the vinyl
        # side. See `_downspout_drop_ft` for the height heuristic.
        "extract": lambda m: _downspout_lf(m),
        "note": lambda m: _downspout_breakdown(m),
    },
    # =====================================================================
    # CAPS — Misc. Labor & Material section is on all 3 tabs.
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Misc. Labor and Material",
        "item": "Cap window",
        "unit": "Each",
        "extract": lambda m: int(m.get("window_count") or 0),
        "note": "1 per window from HOVER",
    },
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Misc. Labor and Material",
        "item": "Cap entry door",
        "unit": "Each",
        "extract": lambda m: int(m.get("entry_door_count") or 0),
        "note": "1 per entry door (D-N prefix, < 72in wide)",
    },
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Misc. Labor and Material",
        "item": "Cap patio door",
        "unit": "Each",
        "extract": lambda m: int(m.get("patio_door_count") or 0),
        "note": "1 per sliding glass / patio door",
    },
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Misc. Labor and Material",
        "item": "Cap single garage door",
        "unit": "Each",
        "extract": lambda m: int(m.get("garage_door_count") or 0),
        "note": "1 per garage door (OHD-N or ≥72×84in)",
    },
    # =====================================================================
    # WINDOWS TAB — per-opening Vero entries are built separately from the
    # extracted windows[] list (see _build_vero_openings below). These two
    # catalog-line mappings cover the labor rows that still live in the
    # standard "Window Installation" section.
    # =====================================================================
    {
        "tabs": ["windows"],
        "section": "Window Installation",
        "item": "Window DH/Slider - Pocket Install",
        "unit": "Each",
        "extract": lambda m: int(m.get("window_count") or 0),
        "note": "Default install method — swap to Full Fin per job",
    },
    {
        "tabs": ["windows"],
        "section": "Sliding Glass Door Install",
        "item": "Vinyl Sliding Glass Door (5' & 6' width)",
        "unit": "Each",
        "extract": lambda m: int(m.get("patio_door_count") or 0),
        "note": "1 install per HOVER patio door",
    },
    {
        "tabs": ["windows"],
        "section": "Window Installation",
        "item": "Cap window (Windows)",
        "unit": "Each",
        "extract": lambda m: int(m.get("window_count") or 0),
        "note": "1 cap per HOVER window (default exterior wrap)",
    },
    # Iter 42e: standard fee + disposal fee — always 1 per HOVER upload on
    # any windows estimate (paired or standalone). Howard wanted these to
    # land automatically since every job carries them.
    {
        "tabs": ["windows"],
        "section": "Window Installation",
        "item": "Job Measure Standard Fee 4 days+",
        "unit": "JOB",
        "extract": lambda m: 1 if (int(m.get("window_count") or 0) > 0 or int(m.get("patio_door_count") or 0) > 0) else 0,
        "note": "Standard measure fee — one per job",
    },
    {
        "tabs": ["windows"],
        "section": "Window Installation",
        "item": "Disposal Fee (Windows)",
        "unit": "JOB",
        "extract": lambda m: 1 if (int(m.get("window_count") or 0) > 0 or int(m.get("patio_door_count") or 0) > 0) else 0,
        "note": "Disposal fee — one per job",
    },
    # Iter 47: auto-fill .019 Coil qty from total window perimeter.
    # Math per Howard: total perimeter LF ÷ 100 LF per roll = qty rolls
    # (each W-N opening contributes 2 × (width + height) inches → ÷12 LF).
    # Lines populate on BOTH Vero (`windows`) and Mezzo (`mezzo`) tabs so
    # the snapshot reflects the trim on whichever brand the contractor
    # presents.
    {
        "tabs": ["windows", "mezzo"],
        "section": "Window Material List",
        "item": "Windows - .019 Coil",
        "unit": "ROLL",
        "extract": lambda m: round(
            sum(
                2 * ((float(w.get("width_in") or 0) + float(w.get("height_in") or 0)) / 12.0)
                for w in (m.get("windows") or [])
            ) / 100.0,
            2,
        ),
        "note": "Auto-calc: sum of window perimeters ÷ 100 LF/roll",
    },
    # Iter 42f: siding-side disposal — fires on vinyl + ascend + lp_smart
    # tabs when HOVER reports any siding to install. The "Tear-Off / Clean
    # Up" section is shared across all 3 siding lines so one line covers
    # whichever option the contractor quotes.
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Tear-Off / Clean Up",
        "item": "clean up/ haul away job debris",
        "unit": "JOB",
        "extract": lambda m: 1 if (m.get("siding_sqft") or 0) > 0 else 0,
        "note": "Disposal — one per job when siding work is present",
    },
]


# -----------------------------------------------------------------------------
# Pydantic
# -----------------------------------------------------------------------------
class HoverLine(BaseModel):
    section: str
    name: str
    unit: str
    qty: float
    note: str = ""
    # Which tab the line belongs to: "vinyl" | "ascend" | "lp_smart". The
    # importer emits one HoverLine per (mapping × tab) so a single upload
    # populates all three parallel option sets in the estimator.
    tab: str = "vinyl"


class HoverVeroOpening(BaseModel):
    """One Vero W×H per-opening row produced from a HOVER window. Mirrors the
    `vero_openings[]` shape the estimator stores on the Estimate doc. Iter 46:
    aligned with the Mezzo-style adders model — no more glass_package /
    tempered_upcharge / premium_options legacy fields."""
    id: str
    product_type: str
    label: str = ""
    width: float
    height: float
    qty: int = 1
    sister_color: str = "White Interior/White Exterior"
    sizing: str = "ui_bucket"
    # Catalog-resolved snapshots are recomputed by VeroPanel after merge.
    bucket_label: str = ""
    base_mat: float = 0
    adders: list = []
    # The original HOVER ID (W-101 etc.) — surfaced in the preview so the
    # contractor can match it back to the elevations.
    hover_id: str = ""


class HoverMezzoOpening(BaseModel):
    """One Mezzo W×H per-opening row produced from a HOVER window. Mirrors
    the `mezzo_openings[]` shape the estimator stores on the Estimate doc.
    Mezzo doesn't have a Casement product type — Vero Casement guesses map
    to Mezzo Double Hung in `_vero_to_mezzo_product_type`."""
    id: str
    product_type: str
    label: str = ""
    width: float
    height: float
    qty: int = 1
    bucket_label: str = ""
    base_mat: float = 0
    adders: list = []
    hover_id: str = ""


class HoverImportResult(BaseModel):
    measurements: dict
    lines: list[HoverLine]
    vero_openings: list[HoverVeroOpening] = []
    mezzo_openings: list[HoverMezzoOpening] = []
    raw_extract_chars: int
    # Iter 78o — sanity-check warnings from `hover_sanity.run_checks`. List
    # of {code, level, message, detail?} dicts. Empty = report looks
    # consistent. Frontend renders these as a yellow banner inside the
    # preview modal so contractors see discrepancies BEFORE they apply.
    warnings: list[dict] = []
    # Iter 78q — Phase 3 Deep Verify cache key. Frontend echoes this back
    # when the contractor clicks "Deep Verify {Elevation}" — backend uses
    # it to look up the cached PNG without re-uploading the PDF. None when
    # no elevation pages were rendered (cached only on successful Phase 2).
    deep_verify_cache_key: Optional[str] = None


# -----------------------------------------------------------------------------
# Parsing
# -----------------------------------------------------------------------------
PROMPT_SYSTEM = (
    "You are a precise data-extraction assistant. You are given the full text "
    "of a HOVER exterior-measurement PDF report. Your job is to pull every "
    "measurement listed and return ONLY a JSON object (no commentary, no "
    "markdown). Use the exact keys defined below. If a value isn't present, "
    "set it to null. All lengths are in feet (decimal — convert 144' 7\" to "
    "144.58 etc.). All areas are square feet."
)

PROMPT_TEMPLATE = """Extract from this HOVER report:

{{
  "siding_sqft": <total Facades Siding area, ft² — the BASE area before any waste>,
  "siding_with_openings_sqft": <value from the "SIDING WASTE TOTALS" section, specifically the line labeled "+ Openings < 20ft² +10%" (or "Openings <20ft² +10%"). This is the siding area AFTER the 10% small-openings adder. ft². If that exact line is not present, return null.>,
  "soffit_sqft": <total Soffit Area, ft²>,
  "eaves_lf": <total Eaves length, feet (decimal)>,
  "rakes_lf": <total Rakes length, feet (decimal)>,
  "starter_lf": <Level Starter Length, feet (decimal)>,
  "outside_corner_count": <Corners Outside Qty>,
  "outside_corner_lf": <Corners Outside Length, feet (decimal)>,
  "inside_corner_count": <Corners Inside Qty>,
  "inside_corner_lf": <Corners Inside Length, feet (decimal)>,
  "opening_count": <Openings Quantity total — windows + doors>,
  "opening_perimeter_lf": <sum of all opening perimeters if shown, else null>,
  "window_count": <number of windows>,
  "window_bottom_width_total_lf": <sum of the bottom-edge (sill) width of EVERY window listed in the Doors & Windows table, in feet (decimal). For each window, take its WIDTH dimension (the shorter horizontal measurement, NOT the height) and add them all together. Example: three windows at 36in (3.0ft), 48in (4.0ft) and 60in (5.0ft) → 12.0. If individual window dimensions aren't shown, set to null.>,
  "door_count": <total number of doors of all types>,
  "entry_door_count": <number of single/double entry doors — `D-N` IDs that are NOT garage-sized (<72in wide OR <84in tall)>,
  "patio_door_count": <number of sliding/patio doors — typically `SGD-N` IDs (Sliding Glass Door), or `FD-N` (French Door)>,
  "garage_door_count": <number of garage/overhead doors — `OHD-N` prefix, or any door with width >= 96in (8ft, the smallest standard garage door). Most garage doors are 96-216in wide.>,
  "stories": <"1" | ">1" | "2" etc as printed>,
  "address": <property address if shown, else null>,
  "level_frieze_lf": <Level Frieze Board Length under Roofline section, feet (decimal). If not present, null.>,
  "sloped_frieze_lf": <Sloped Frieze Board Length under Roofline section, feet (decimal). If not present, null.>,
  "drip_edge_lf": <Drip Edge / Perimeter Length under Roof Measurements, feet (decimal). If not present, null.>,
  "total_trim_sqft": <Total Trim Area from the Areas table (Trims row), ft². If not present, null.>,
  "shutter_count": <Accessories → Shutter Qty (total individual shutters, NOT pairs). If not present, null.>,
  "vent_count": <Accessories → Vents Qty (gable/roof vents). If not present, null.>,
  "united_inches": <Total United Inches across all window openings (sum of width_in + height_in for each window). If not present, null.>,
  "per_elevation_siding": {{
    "front": <Front elevation siding sqft, or null>,
    "back": <Back elevation siding sqft, or null>,
    "left": <Left elevation siding sqft, or null>,
    "right": <Right elevation siding sqft, or null>
  }},
  "roof_area_sqft": <Total Roof Area, ft². If not present, null.>,
  "windows": [
    {{ "id": "W-101", "width_in": 29.0, "height_in": 51.0 }},
    ... one object per individual window opening listed in the Doors & Windows table ...
  ]
}}

Window extraction rules:
  - Pull EVERY individual window listed (W-101, W-202, etc.). Window-group rows
    (WG-1, WG-2) are usually composites of the underlying W-N openings — skip
    the WG rows and only emit the individual W-N entries.
  - width_in is the SHORTER horizontal dimension (always the first number).
  - height_in is the VERTICAL dimension (second number).
  - Always emit inches as decimals. `29"` → 29.0.
  - Skip rows that are clearly doors (D-, SGD-, FD-, OHD- prefix).
  - If no individual window dimensions are available, emit an empty list [].

Door classification rules (apply in this order):
  1. Any door with prefix `SGD-` or `FD-` → patio_door_count
  2. Any door with prefix `OHD-` → garage_door_count
  3. Any door with width >= 96in (8ft) → garage_door_count (standard garage door size starts at 96in; 72in is too narrow to be a garage)
  4. All other doors (single front doors at 36in wide, double doors at 72in wide × 80in tall, etc.) → entry_door_count

The three counts (entry + patio + garage) must sum to door_count.

Convert all `7' 5"` style values to decimal feet. Example: `7' 5"` → 7.42.

PDF text follows:
---
{text}
---
Return ONLY the JSON object."""


def _extract_pdf_text(raw: bytes) -> str:
    """Pull plain text from a HOVER PDF. We collect each page separately and
    join with double-newlines so the LLM can still see section boundaries."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(raw)
        path = f.name
    try:
        with pdfplumber.open(path) as pdf:
            parts = []
            for p in pdf.pages:
                t = p.extract_text() or ""
                if t.strip():
                    parts.append(t)
            return "\n\n".join(parts)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _strip_json_fence(s: str) -> str:
    """Claude usually returns clean JSON, but occasionally wraps in ```json fences.
    Strip both common variants before parsing."""
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    return s.strip()


async def _ask_claude(text: str, session_id: str) -> dict:
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY missing on server")
    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=PROMPT_SYSTEM,
    ).with_model("anthropic", "claude-opus-4-5-20251101")  # Iter 58: upgraded from Sonnet 4.5 to Opus 4.5 — matches AI Measure for max accuracy on edge HOVER PDFs
    msg = UserMessage(text=PROMPT_TEMPLATE.format(text=text[:60000]))  # safety cap
    try:
        reply = await chat.send_message(msg)
    except Exception as e:
        # Surface the most common, actionable failure modes as friendly 4xx
        # errors instead of generic 500s. Budget exhaustion is by far the
        # most likely cause once a contractor runs a few large HOVER PDFs.
        msg = str(e).lower()
        if "budget" in msg and "exceed" in msg:
            raise HTTPException(
                status_code=402,
                detail=(
                    "Universal LLM key budget exceeded. Add balance in your "
                    "Emergent profile (Profile → Universal Key → Add Balance) "
                    "and retry the HOVER import."
                ),
            ) from e
        if "rate" in msg and "limit" in msg:
            raise HTTPException(
                status_code=429,
                detail="LLM rate limit hit — wait a few seconds and retry.",
            ) from e
        # Unknown LLM error — bubble up with detail so it's not a blind 500
        logger.exception("HOVER LLM call failed")
        raise HTTPException(
            status_code=502,
            detail=f"HOVER parser failed talking to the LLM ({e})",
        ) from e
    try:
        return json.loads(_strip_json_fence(reply))
    except json.JSONDecodeError as e:
        logger.warning("Claude returned non-JSON: %s", reply[:400])
        raise HTTPException(
            status_code=502,
            detail=f"Could not parse measurements from HOVER report (LLM JSON parse failed: {e})",
        ) from e


# Iter 78z (P1.2) — Per-profile siding SKU lookup. Maps a canonical
# profile family (from profile_callouts.classify_profile) to the right
# catalog SKU on each siding tab. Tuple shape: (item_name, unit,
# sqft_per_unit). qty = ceil(sqft / sqft_per_unit) rounded to 1 decimal.
# When a profile has no SKU on a given tab (e.g. Ascend has no Shake),
# the row is silently skipped — the contractor can manually add a
# substitute. The vinyl + ascend SQ rates use 100 sqft/SQ; LP uses 11
# PCS/SQ for lap/shake/nickel-gap (consistent with Iter 67 conversion),
# and 32 sqft/PCS for 4'×8' panels.
_PROFILE_SKU_MAP: dict[tuple[str, str], tuple[str, str, float]] = {
    # ---- Vinyl tab — Charter Oak family ------------------------------
    ("lap",          "vinyl"):    ('Charter Oak Standard color Dutch Lap 4.5" .046', "SQ", 100.0),
    ("dutch_lap",    "vinyl"):    ('Charter Oak Standard color Dutch Lap 4.5" .046', "SQ", 100.0),
    ("shake",        "vinyl"):    ('Pelican Bay Shakes 9"',                          "SQ", 100.0),
    ("board_batten", "vinyl"):    ('vertical board and batten Standard color 7"',   "SQ", 100.0),
    ("vertical",     "vinyl"):    ('vertical board and batten Standard color 7"',   "SQ", 100.0),
    # ---- Ascend tab --------------------------------------------------
    ("lap",          "ascend"):   ('Ascend Composite Lap Siding 7"',                       "SQ", 100.0),
    ("dutch_lap",    "ascend"):   ('Ascend Composite Lap Siding 7"',                       "SQ", 100.0),
    ("board_batten", "ascend"):   ('Ascend Composite B&B 12" (add 30% Waste)',             "SQ", 100.0),
    ("vertical",     "ascend"):   ('Ascend Composite B&B 12" (add 30% Waste)',             "SQ", 100.0),
    # Shake has no Ascend SKU — skipped.
    # ---- LP tab — 38 Series + Shake + Nickel Gap ---------------------
    # Legacy uniform 9.09 sqft/PCS conversion. When LP_AI_FORMULAS_V1 is
    # enabled, `_lp_profile_sku_entry()` below overrides these with the
    # PDF-accurate per-profile coverage (8" Lap = 9.17, Shake @ 7" = 2.33,
    # etc.) per Howard's master LP reference (2026-02-28).
    ("lap",          "lp_smart"): ('38 Series Lap 3/8" x 8" x 16\'', "PCS", 100.0 / 11),  # ≈9.09 sqft/pc
    ("dutch_lap",    "lp_smart"): ('38 Series Lap 3/8" x 8" x 16\'', "PCS", 100.0 / 11),
    ("shake",        "lp_smart"): ('Shake',                          "PCS", 100.0 / 11),
    ("nickel_gap",   "lp_smart"): ('Nickel Gap',                     "PCS", 100.0 / 11),
    ("board_batten", "lp_smart"): ('38 Series Vertical Panel',       "PCS", 32.0),
    ("vertical",     "lp_smart"): ('38 Series Vertical Panel',       "PCS", 32.0),
}


def _lp_profile_sku_entry(family: str) -> tuple[str, str, float] | None:
    """Iter 78ab — When `LP_AI_FORMULAS_V1` is enabled, return the LP
    SKU + accurate per-profile coverage rate from the PDF formulas
    (8" Lap / 16" Soffit / 7" shake reveal defaults). Else None so
    the caller falls back to the legacy `_PROFILE_SKU_MAP` row.

    Coverage rates are sqft per PCS — keep the unit aligned with the
    legacy map so the qty math (`sqft / sqft_per_unit`) is unchanged.
    """
    if not lp_formulas.is_enabled():
        return None
    if family in ("lap", "dutch_lap"):
        return (
            '38 Series Lap 3/8" x 8" x 16\'',
            "PCS",
            lp_formulas.lap_coverage_sqft_per_pc(),  # default 8" Lap
        )
    if family == "shake":
        return (
            'Shake',
            "PCS",
            lp_formulas.shake_coverage_sqft_per_pc(lp_formulas.DEFAULT_SHAKE_REVEAL_INCHES),
        )
    if family == "nickel_gap":
        return (
            'Nickel Gap',
            "PCS",
            lp_formulas.NICKEL_GAP_COVERAGE_SQFT_PER_PC,
        )
    if family in ("board_batten", "vertical"):
        return (
            "38 Series 4' x 10' Panel",
            "PCS",
            lp_formulas.BB_PANEL_COVERAGE_SQFT,
        )
    return None

# Section per tab for the per-profile siding lines (keyed by tab).
_PROFILE_SECTION_BY_TAB = {
    "vinyl":    "Vinyl Siding",
    "ascend":   "Ascend Cladding",
    "lp_smart": "LP Smart Siding",
}


def _profile_siding_lines(measurements: dict) -> list[dict]:
    """Emit one siding line per profile family per tab when the AI/
    Blueprint pipeline returned a multi-profile breakdown.

    Returns [] when:
      - `_per_profile_sqft` is absent (HOVER PDF imports — keep
        default mapping)
      - only 1 profile family is present (single-profile house —
        default mapping still wins because it uses HOVER's small-
        opening 10% adder)
      - no profiles have positive sqft

    Notes the contractor will see on each emitted line:
      "Per-elevation breakdown: SHAKE 168 ft²"
    """
    per_profile = measurements.get("_per_profile_sqft") or {}
    if not isinstance(per_profile, dict):
        return []
    positive = {f: s for f, s in per_profile.items() if isinstance(s, (int, float)) and s > 0}
    if len(positive) <= 1:
        return []
    out: list[dict] = []
    for tab in ("vinyl", "ascend", "lp_smart"):
        section = _PROFILE_SECTION_BY_TAB[tab]
        for family, sqft in positive.items():
            # Iter 78ab — flag-aware LP override. When
            # LP_AI_FORMULAS_V1 is ON, swap the legacy 9.09 sqft/PCS
            # row for the PDF-accurate per-profile coverage rate.
            sku = None
            if tab == "lp_smart":
                sku = _lp_profile_sku_entry(family)
            if sku is None:
                sku = _PROFILE_SKU_MAP.get((family, tab))
            if not sku:
                continue
            item, unit, sqft_per_unit = sku
            if sqft_per_unit <= 0:
                continue
            # Iter 78ab — LP tab applies 10% waste + round-up per PDF.
            # Vinyl + Ascend keep the legacy 1-decimal quantity to
            # preserve existing quote behaviour.
            if tab == "lp_smart" and lp_formulas.is_enabled():
                qty = lp_formulas.pieces_needed(sqft, sqft_per_unit)
            else:
                qty = round(sqft / sqft_per_unit, 1)
            if qty <= 0:
                continue
            out.append({
                "tab": tab,
                "section": section,
                "name": item,
                "unit": unit,
                "qty": qty,
                "note": f"Per-elevation breakdown: {family.upper().replace('_', ' ')} {sqft:.0f} ft²",
            })
    return out




def _build_lines(measurements: dict) -> list[dict]:
    out = []
    # Iter 78z (P1.2) — Multi-profile siding split. When the AI Measure /
    # Blueprint pipeline returns a per-profile breakdown (Campbell-style
    # houses with Lap on the body + Shake on the gables + B&B on the
    # porch), emit ONE siding line per profile family and skip the
    # default single-SKU rows below. Single-profile houses (or HOVER PDF
    # imports that don't carry the breakdown) keep the existing default
    # mapping.
    profile_lines = _profile_siding_lines(measurements)
    skip_default_siding = len(profile_lines) > 0
    if profile_lines:
        out.extend(profile_lines)
    for spec in HOVER_MAPPING_SPEC:
        if skip_default_siding and spec.get("_is_default_siding"):
            continue
        try:
            qty = float(spec["extract"](measurements))
        except (TypeError, ValueError):
            qty = 0
        if qty <= 0:
            continue
        # Emit one line per tab the spec targets. The contractor's estimator
        # already creates parallel entries for every (tab, section, item)
        # tuple, so we never need to fabricate mat/lab here — the frontend
        # merge keys by (tab, section, item) and finds the right row.
        # `note` may be a static string or a callable taking `measurements`
        # → per-job string (used by the J-channel rule for its formula
        # breakdown, Iter 57ee).
        note_val = spec["note"]
        if callable(note_val):
            try:
                note_val = note_val(measurements)
            except Exception:
                note_val = ""
        for tab in spec["tabs"]:
            out.append({
                "tab": tab,
                "section": spec["section"],
                "name": spec["item"],
                "unit": spec["unit"],
                "qty": qty,
                "note": note_val,
            })
    return out


def _build_window_openings(measurements: dict) -> tuple[list[dict], list[dict]]:
    """Turn the extracted `windows[]` list into BOTH Vero and Mezzo opening
    rows so the contractor can quote both brands side-by-side on the
    paired windows estimate. The two arrays are paired 1:1 — they share
    UUIDs and the same HOVER id, with product_type derived from the SAME
    W×H guess (`_vero_to_mezzo_product_type` maps the Vero guess to the
    nearest Mezzo product since Mezzo has no Casement)."""
    vero_out: list[dict] = []
    mezzo_out: list[dict] = []
    raw = measurements.get("windows") or []
    if not isinstance(raw, list):
        return vero_out, mezzo_out
    for w in raw:
        try:
            wid = float(w.get("width_in") or 0)
            hgt = float(w.get("height_in") or 0)
        except (TypeError, ValueError):
            continue
        if wid <= 0 or hgt <= 0:
            continue
        hover_id = str(w.get("id") or "").strip()
        vero_type = _guess_vero_product_type(wid, hgt)
        mezzo_type = _vero_to_mezzo_product_type(vero_type)
        # Share UUID + label across both brands so the FE preview can show
        # one editable row that drives both, and so a contractor who skips
        # one side can still identify the matching opening on the other.
        opening_id = str(uuid.uuid4())
        vero_out.append({
            "id": opening_id,
            "hover_id": hover_id,
            "product_type": vero_type,
            "label": hover_id,
            "width": wid,
            "height": hgt,
            "qty": 1,
            "sister_color": "White Interior/White Exterior",
            "sizing": "ui_bucket",
            "bucket_label": "",
            "base_mat": 0,
            # Iter 46: Vero uses Mezzo-style adders. The frontend
            # auto-seeds "Climatech Plus" via VeroPanel's reconciliation
            # hook on first render so we don't bake it in here.
            "adders": [],
        })
        mezzo_out.append({
            "id": opening_id,
            "hover_id": hover_id,
            "product_type": mezzo_type,
            "label": hover_id,
            "width": wid,
            "height": hgt,
            "qty": 1,
            "bucket_label": "",
            "base_mat": 0,
            "adders": [],
        })
    return vero_out, mezzo_out


# -----------------------------------------------------------------------------
# Iter 78q — Phase 3 Deep Verify
# -----------------------------------------------------------------------------
async def _ensure_deep_verify_index():
    """Create the TTL index on `hover_page_cache.created_at` so cached
    elevation PNGs auto-purge 1 hour after import. Idempotent — Mongo
    silently no-ops if the index already exists."""
    if db is None:
        return
    try:
        await db.hover_page_cache.create_index(
            "created_at", expireAfterSeconds=3600,
        )
    except Exception as e:
        logger.warning("Iter 78q: TTL index create failed: %s", e)


@router.post("/estimates/hover-deep-verify")
async def hover_deep_verify(
    payload: dict,
    user: dict = Depends(get_current_user),
):
    """Phase 3 Deep Verify endpoint. Replays a single cached elevation PNG
    against a scale-bar-focused Claude Vision prompt that explicitly
    IGNORES the dim callouts and re-derives the wall area from the
    scale bar. Returns the new measurement + a 3-way comparison
    (deep-verify vs Phase 2 drawing vs text)."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    cache_key = (payload or {}).get("cache_key")
    label = (payload or {}).get("label")
    measurements = (payload or {}).get("measurements") or {}
    phase2_drawing = (payload or {}).get("phase2_drawing") or {}
    if not cache_key or not label:
        raise HTTPException(
            status_code=400, detail="cache_key and label are required",
        )
    cached = await db.hover_page_cache.find_one(
        {"cache_key": cache_key, "label": label},
        {"_id": 0, "png_b64": 1, "user_id": 1},
    )
    if not cached or not cached.get("png_b64"):
        raise HTTPException(
            status_code=404,
            detail=(
                "Cached page not found or expired (1-hour TTL). "
                "Re-import the HOVER PDF to refresh the cache."
            ),
        )
    if cached.get("user_id") and cached["user_id"] != user.get("id"):
        # Same-user scope: a contractor can only Deep Verify their own
        # cached imports.
        raise HTTPException(status_code=403, detail="Access denied")
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="LLM key not configured")
    from routes.hover_vision import deep_verify_elevation, reconcile_deep_verify
    deep_result = await deep_verify_elevation(
        cached["png_b64"], label, api_key,
        session_id=f"deep-verify-{user.get('id','anon')}-{cache_key[:8]}",
    )
    if not deep_result.get("ok"):
        raise HTTPException(
            status_code=502,
            detail=f"Deep Verify call failed: {deep_result.get('error', 'unknown')}",
        )
    return reconcile_deep_verify(deep_result, measurements, phase2_drawing)


# -----------------------------------------------------------------------------
# Endpoint
# -----------------------------------------------------------------------------
@router.post("/estimates/hover-import", response_model=HoverImportResult)
async def hover_import(
    file: UploadFile = File(...),
    overhang_in: float = Form(12.0),
    user: dict = Depends(get_current_user),
) -> HoverImportResult:
    """Upload a HOVER PDF, return parsed measurements + a draft `lines[]`
    payload the frontend can preview before committing to the estimate.

    `overhang_in` (inches) flows into the soffit piece-count formula —
    frontend sends the estimate's current overhang so the imported qty
    matches what the contractor will see in Job Info.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a .pdf file")
    raw = await file.read()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF too large (>20MB)")

    text = _extract_pdf_text(raw)
    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail="Could not extract text from PDF — is this a scanned/image PDF?",
        )
    measurements = await _ask_claude(text, session_id=f"hover-{user.get('id','anon')}")
    # Pull the per-window list out of measurements so the FE measurements
    # iterator can safely render every remaining value as a primitive.
    windows_payload = measurements.pop("windows", None) or []
    vero_openings, mezzo_openings = _build_window_openings({"windows": windows_payload})
    measurements["overhang_in"] = overhang_in
    lines = _build_lines(measurements)
    # Iter 78o — Phase 1 sanity checks: deterministic rules over the
    # extracted measurements. Surfaced as a yellow banner in the preview
    # modal so contractors catch HOVER mis-reads BEFORE applying.
    from routes.hover_sanity import run_checks
    warnings = run_checks(measurements)
    # Iter 78p — Phase 2 vision verification: render elevation drawing
    # pages, send each to Claude Opus 4.5 Vision, compare drawing-derived
    # area to text-extracted siding_sqft / per_elevation_siding. Returns
    # additional warnings (same banner) + per-elevation drawing data we
    # stash on `measurements` for the Per-Elevation Breakdown card.
    # Iter 78q — also stash rendered PNGs in MongoDB (TTL 1h) so the
    # contractor can trigger Phase 3 Deep Verify on any elevation without
    # re-uploading the PDF.
    deep_verify_cache_key: Optional[str] = None
    try:
        from routes.hover_vision import run_vision_pass
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if api_key:
            deep_verify_cache_key = f"dv-{uuid.uuid4().hex}"

            async def _cache_writer(key: str, label: str, png_b64: str, page_num: int):
                if db is None:
                    return
                await db.hover_page_cache.update_one(
                    {"cache_key": key, "label": label},
                    {"$set": {
                        "cache_key": key,
                        "label": label,
                        "page_num": page_num,
                        "png_b64": png_b64,
                        "user_id": user.get("id"),
                        "created_at": datetime.now(timezone.utc),
                    }},
                    upsert=True,
                )

            vision_warns, per_elev_drawing = await run_vision_pass(
                raw, measurements, api_key,
                session_id=f"hover-vision-{user.get('id','anon')}",
                cache_key=deep_verify_cache_key,
                cache_writer=_cache_writer,
            )
            warnings.extend(vision_warns)
            if per_elev_drawing:
                measurements["per_elevation_siding_from_drawing"] = per_elev_drawing
    except Exception as e:
        logger.warning("Iter 78p/q: vision pass failed silently: %s", e)
    return HoverImportResult(
        measurements=measurements,
        lines=[HoverLine(**ln) for ln in lines],
        vero_openings=[HoverVeroOpening(**op) for op in vero_openings],
        mezzo_openings=[HoverMezzoOpening(**op) for op in mezzo_openings],
        raw_extract_chars=len(text),
        warnings=warnings,
        deep_verify_cache_key=deep_verify_cache_key,
    )
