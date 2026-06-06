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
from typing import Optional

import pdfplumber
from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from deps import get_current_user

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
        "item": "Ascend 3.5\" Outside Corner  - MATTE",
        "unit": "PCS",
        "extract": lambda m: max(1, round((m.get("outside_corner_lf") or 0) / 10)),
        "note": "Ascend 10' outside-corner pieces / corner LF",
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
    # STARTER LF — only Ascend is auto-filled (qty = LF ÷ 100 per Howard,
    # matching Ascend's per-PCS pricing). Vinyl Starter is now per-PCS too
    # in the catalog but the LF→PCS conversion isn't a clean number, so we
    # leave Vinyl Starter for manual entry. LP has no dedicated starter.
    # =====================================================================
    {
        "tabs": ["ascend"],
        "section": "Ascend Cladding/Accessories",
        "item": "Ascend - Starter",
        "unit": "PCS",
        "extract": lambda m: round((m.get("starter_lf") or 0) / 100, 2),
        "note": "Ascend Starter qty = HOVER starter LF ÷ 100 (per Howard)",
    },
    # =====================================================================
    # FINISH TRIM — left for manual entry on BOTH vinyl and Ascend per
    # Howard's request. HOVER's starter LF often doesn't translate to the
    # top course cleanly, so contractors prefer to enter Finish Trim
    # themselves. The yellow Lightbulb on the row still prompts them.
    # =====================================================================
    # =====================================================================
    # J-CHANNEL (Vinyl only — Ascend J-Channel unit is ambiguous in the
    # catalog vs how it's actually counted, so we leave Ascend J-Channel
    # for manual entry. LP doesn't use J-channel.)
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
    # WINDOWS TAB — Vero product line. HOVER reports window count + entry/
    # patio door counts. Default mappings:
    #   - 1 Vero Double Hung per HOVER window (most common style; contractor
    #     swaps to slider/casement/picture per line)
    #   - 1 Pocket Install labor row per window (most common install method
    #     for replacement jobs; contractor swaps to Full Fin / Block Frame
    #     as needed)
    #   - 1 of each appropriate Sliding Glass Door + install line per
    #     HOVER patio_door_count, defaulting to 60" × 80"
    # =====================================================================
    {
        "tabs": ["windows"],
        "section": "Vero Windows",
        "item": "Vero - Double Hung 0-101 UI",
        "unit": "Each",
        "extract": lambda m: int(m.get("window_count") or 0),
        "note": "1 per HOVER window — change style on the line if needed",
    },
    {
        "tabs": ["windows"],
        "section": "Window Installation",
        "item": "Window - Pocket Install",
        "unit": "Each",
        "extract": lambda m: int(m.get("window_count") or 0),
        "note": "Default install method — swap to Full Fin/Block Frame per job",
    },
    {
        "tabs": ["windows"],
        "section": "Vero Sliding Glass Doors",
        "item": 'Vero - Sliding glass door 60" x 80"',
        "unit": "Each",
        "extract": lambda m: int(m.get("patio_door_count") or 0),
        "note": "1 per HOVER patio door — change size on the line if needed",
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


class HoverImportResult(BaseModel):
    measurements: dict
    lines: list[HoverLine]
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
  "door_count": <total number of doors of all types>,
  "entry_door_count": <number of single/double entry doors — `D-N` IDs that are NOT garage-sized (<72in wide OR <84in tall)>,
  "patio_door_count": <number of sliding/patio doors — typically `SGD-N` IDs (Sliding Glass Door), or `FD-N` (French Door)>,
  "garage_door_count": <number of garage/overhead doors — `OHD-N` prefix, or any door with width >= 96in (8ft, the smallest standard garage door). Most garage doors are 96-216in wide.>,
  "stories": <"1" | ">1" | "2" etc as printed>,
  "address": <property address if shown, else null>
}}

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
    lines = _build_lines(measurements)
    return HoverImportResult(
        measurements=measurements,
        lines=[HoverLine(**ln) for ln in lines],
        raw_extract_chars=len(text),
    )
