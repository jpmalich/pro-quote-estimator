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
import os
import re
import tempfile
import uuid
from typing import Optional

import pdfplumber
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from deps import get_current_user


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
    w = float(width_in or 0)
    h = float(height_in or 0)
    if w <= 0 or h <= 0:
        return "Vero Double Hung"

    # Casement = TRULY small openings (kitchen above-sink, bath transom).
    # Howard's stock answer is DH for anything else, so keep this tight.
    if w <= 28 and h <= 36:
        return "Vero 1-Lite Casement"
    # Picture = large + nearly square fixed glass. Requires BOTH sides ≥ 48"
    # and < 20% aspect difference so we don't catch tall bedroom DHs (49×62).
    if w >= 48 and h >= 48 and abs(w - h) / max(w, h) < 0.20:
        return "Vero Picture"
    # 3-Lite slider (XOX) = very wide AND landscape orientation
    if w >= 60 and w > h:
        return "Vero 3-Lite Slider"
    # 2-Lite slider (XO) = wide AND landscape orientation
    if w >= 40 and w > h:
        return "Vero 2-Lite Slider"
    # Default everything else to DH (matches Howard's 99% bias for replacements)
    return "Vero Double Hung"


# Vero → Mezzo product type map. Mezzo doesn't have a Casement option, so
# small Casement-guessed openings fall back to DH on the Mezzo side.
_VERO_TO_MEZZO = {
    "Vero Double Hung":      "Mezzo Double Hung",
    "Vero 2-Lite Slider":    "Mezzo 2-Lite Slider",
    "Vero 3-Lite Slider":    "Mezzo 3-Lite Slider",
    "Vero Picture":          "Mezzo Picture",
    "Vero 1-Lite Casement":  "Mezzo Double Hung",  # no casement in Mezzo line
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
HOVER_MAPPING_SPEC = [
    # =====================================================================
    # HEADLINE SIDING — one per tab. We use HOVER's "+ Openings < 20ft²
    # +10%" row (from SIDING WASTE TOTALS) so the small-opening adder is
    # already baked in. Raw facades area is the fallback.
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
    },
    {
        "tabs": ["lp_smart"],
        "section": "LP Smart Siding",
        "item": "LP Strand Lap Siding 3/8\" x 8\" x 16'",
        "unit": "SQ",
        "extract": lambda m: round(
            ((m.get("siding_with_openings_sqft") or m.get("siding_sqft") or 0)) / 100.0,
            1,
        ),
        "note": "LP Strand Lap priced per SQ (11 PCS per SQ per LP price sheet)",
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
        "extract": lambda m: max(1, round((m.get("outside_corner_lf") or 0) / 10)),
        "note": "Vinyl 10' pieces / outside-corner LF — defaults to Standard color",
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "Ascend 5.5\" Outside Corner  - MATTE",
        "unit": "PCS",
        "extract": lambda m: max(1, round((m.get("outside_corner_lf") or 0) / 10)),
        "note": "Ascend 10' outside-corner pieces / corner LF (5.5\" default)",
    },
    {
        "tabs": ["lp_smart"],
        "section": "LP Siding Accessories",
        "item": "LP Outside corners 4\" x 16'",
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
        "extract": lambda m: max(0, round((m.get("inside_corner_lf") or 0) / 10)),
        "note": "10' pieces per HOVER inside-corner LF — defaults to Standard color",
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "Inside Corners",
        "unit": "PCS",
        "extract": lambda m: max(0, round((m.get("inside_corner_lf") or 0) / 10)),
        "note": "Ascend inside-corner pieces / corner LF",
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
        "extract": lambda m: round((m.get("starter_lf") or 0) / 10, 2),
        "note": "Vinyl Starter qty = HOVER starter LF ÷ 10 (per Howard)",
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "Ascend - Starter",
        "unit": "PCS",
        "extract": lambda m: round((m.get("starter_lf") or 0) / 10, 2),
        "note": "Ascend Starter qty = HOVER starter LF ÷ 10 (per Howard)",
    },
    # =====================================================================
    # FINISH TRIM — qty = (eaves LF + sum of window bottom widths) ÷ 10
    # (per Howard, matching the per-PCS catalog unit — same divisor as
    # Starter). Defaults to Standard color on vinyl; Architectural color
    # variant is left for manual selection. Same formula on Ascend.
    # If the HOVER report doesn't break out per-window widths, that piece
    # falls back to 0 and the contractor can top-up the qty manually.
    # =====================================================================
    {
        "tabs": ["vinyl"],
        "section": "Siding Accessories",
        "item": "Finish Trim Standard color",
        "unit": "PCS",
        "extract": lambda m: round(
            ((m.get("eaves_lf") or 0)
             + (m.get("window_bottom_width_total_lf") or 0)) / 10,
            2,
        ),
        "note": "(Eaves LF + window bottom widths) ÷ 10 (per Howard)",
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "ASCEND Finish Trim",
        "unit": "PCS",
        "extract": lambda m: round(
            ((m.get("eaves_lf") or 0)
             + (m.get("window_bottom_width_total_lf") or 0)) / 10,
            2,
        ),
        "note": "(Eaves LF + window bottom widths) ÷ 10 (per Howard)",
    },
    # =====================================================================
    # J-CHANNEL — vinyl + Ascend. Same formula on both: 2 PCS per SQ of
    # siding (wall runs) + 1 PCS per 10' of opening perimeter. LP doesn't
    # use J-channel.
    # =====================================================================
    {
        "tabs": ["vinyl"],
        "section": "Siding Accessories",
        "item": "3/4\" J-Channel Standard color (2 per Sq of siding)",
        "unit": "PCS",
        "extract": lambda m: max(0, round(
            ((m.get("siding_sqft") or 0) / 100.0) * 2
            + (m.get("opening_perimeter_lf") or 0) / 10
        )),
        "note": "2/SQ siding + perimeter ÷ 10' around openings — defaults to Standard color",
    },
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "Ascend - J - Channel  (2 per Sq of siding)",
        "unit": "PCS",
        "extract": lambda m: max(0, round(
            ((m.get("siding_sqft") or 0) / 100.0) * 2
            + (m.get("opening_perimeter_lf") or 0) / 10
        )),
        "note": "2/SQ siding + perimeter ÷ 10' around openings (per Howard)",
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
    # WALL UNDERLAYMENT — vinyl gets House Wrap; Ascend gets RainDrop (the
    # rainscreen underlayment Ascend installers prefer). LP has no
    # underlayment line in the catalog.
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
        "item": "RainDrop",
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
    # SOFFIT — vinyl + ascend share the standard soffit/fascia line; LP
    # has its own panel-based soffit (16' boards).
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Vinyl Soffit with Siding",
        "item": "Soffit & fascia up to 13\" wide Charter Oak Standard color",
        "unit": "LF",
        "extract": lambda m: round((m.get("eaves_lf") or 0) + (m.get("rakes_lf") or 0)),
        "note": "Eaves LF + Rakes LF — defaults to Standard color",
    },
    {
        "tabs": ["vinyl", "ascend"],
        "section": "Vinyl Soffit with Siding",
        "item": "3/4\" Soffit J-Channel (Charter Oak) Standard color",
        "unit": "LF",
        "extract": lambda m: round((m.get("eaves_lf") or 0) + (m.get("rakes_lf") or 0)),
        "note": "Matches Soffit & fascia LF — defaults to Standard color",
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
        "extract": lambda m: round(m.get("eaves_lf") or 0),
        "note": "Eaves LF (per Howard)",
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
    {
        "tabs": ["lp_smart"],
        "section": "LP SmartSide Soffit",
        "item": "LP Soffit 3/8\" x 16\" x 16' Vented",
        "unit": "PCS",
        "extract": lambda m: max(
            1, round(((m.get("eaves_lf") or 0) + (m.get("rakes_lf") or 0)) / 16)
        ),
        "note": "LP soffit boards are 16' — (eaves + rakes LF) / 16",
    },
    # =====================================================================
    # GUTTER — all 3 tabs share the Seamless Gutter section.
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Seamless Gutter",
        "item": "Gutter 6\"",
        "unit": "LF",
        "extract": lambda m: round(m.get("eaves_lf") or 0),
        "note": "Eaves LF (gutters run along eaves, not rakes)",
    },
    # =====================================================================
    # CAPS — Misc. Labor & Material section is on all 3 tabs.
    # =====================================================================
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Misc. Labor & Material",
        "item": "Cap window",
        "unit": "Each",
        "extract": lambda m: int(m.get("window_count") or 0),
        "note": "1 per window from HOVER",
    },
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Misc. Labor & Material",
        "item": "Cap entry door",
        "unit": "Each",
        "extract": lambda m: int(m.get("entry_door_count") or 0),
        "note": "1 per entry door (D-N prefix, < 72in wide)",
    },
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Misc. Labor & Material",
        "item": "Cap patio door",
        "unit": "Each",
        "extract": lambda m: int(m.get("patio_door_count") or 0),
        "note": "1 per sliding glass / patio door",
    },
    {
        "tabs": ["vinyl", "ascend", "lp_smart"],
        "section": "Misc. Labor & Material",
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
        "note": "Default install method — swap to Full Fin/Block Frame per job",
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
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
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


def _build_lines(measurements: dict) -> list[dict]:
    out = []
    for spec in HOVER_MAPPING_SPEC:
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
        for tab in spec["tabs"]:
            out.append({
                "tab": tab,
                "section": spec["section"],
                "name": spec["item"],
                "unit": spec["unit"],
                "qty": qty,
                "note": spec["note"],
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
# Endpoint
# -----------------------------------------------------------------------------
@router.post("/estimates/hover-import", response_model=HoverImportResult)
async def hover_import(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> HoverImportResult:
    """Upload a HOVER PDF, return parsed measurements + a draft `lines[]`
    payload the frontend can preview before committing to the estimate."""
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
    lines = _build_lines(measurements)
    return HoverImportResult(
        measurements=measurements,
        lines=[HoverLine(**ln) for ln in lines],
        vero_openings=[HoverVeroOpening(**op) for op in vero_openings],
        mezzo_openings=[HoverMezzoOpening(**op) for op in mezzo_openings],
        raw_extract_chars=len(text),
    )
