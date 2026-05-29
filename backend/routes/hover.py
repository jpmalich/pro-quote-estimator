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
# Map HOVER measurements → catalog line items. Each entry is:
#   (section, item_name, unit, qty_callable)
# qty_callable receives the parsed HOVER dict and returns the raw (pre-waste)
# qty. The waste factor itself is applied later by calc_totals — we set
# qty here equal to the *measured* requirement.
#
# Industry-standard ratios are documented inline so Howard can tune them.
HOVER_MAPPING_SPEC = [
    # SIDING — auto-populate as SQ (squares = 100 sqft). Howard sells by SQ.
    # We add an empty Charter Oak Clap 4.5" .046 row at 0 mat so the contractor
    # can pick a different profile via the existing line editor.
    {
        "section": "Vinyl Siding",
        "item": "Charter Oak Clap 4.5\" .046",
        "unit": "SQ",
        "extract": lambda m: round((m.get("siding_sqft") or 0) / 100.0, 1),
        "note": "Default siding pick — change profile via edit if needed",
    },
    # ACCESSORIES — corners, J-channel, starter, finish trim, house wrap, nails
    {
        "section": "Siding Accessories",
        "item": "Outside corners",
        "unit": "PCS",
        # Outside corner posts are 10' pieces. HOVER gives total corner LF.
        "extract": lambda m: max(1, round((m.get("outside_corner_lf") or 0) / 10)),
        "note": "10' pieces per HOVER outside-corner LF",
    },
    {
        "section": "Siding Accessories",
        "item": "Inside Corners (Siding)",
        "unit": "PCS",
        # Inside corners use 10' pieces too.
        "extract": lambda m: max(0, round((m.get("inside_corner_lf") or 0) / 10)),
        "note": "10' pieces per HOVER inside-corner LF",
    },
    {
        "section": "Siding Accessories",
        "item": "Starter",
        "unit": "LF",
        "extract": lambda m: round(m.get("starter_lf") or 0),
        "note": "LF along bottom course",
    },
    {
        "section": "Siding Accessories",
        "item": "Finish Trim",
        "unit": "LF",
        "extract": lambda m: round(m.get("starter_lf") or 0),  # top = bottom for a typical wall
        "note": "LF along top course (mirrors starter for typical walls)",
    },
    {
        "section": "Siding Accessories",
        "item": "3/4\" J-Channel (2 per Sq of siding)",
        "unit": "PCS",
        # 2 pieces per SQ siding + opening perimeter ÷ 10'
        "extract": lambda m: max(0, round(
            ((m.get("siding_sqft") or 0) / 100.0) * 2
            + (m.get("opening_perimeter_lf") or 0) / 10
        )),
        "note": "2/SQ siding + perimeter ÷ 10' around openings",
    },
    {
        "section": "Siding Accessories",
        "item": "House Wrap",
        "unit": "SQ",
        "extract": lambda m: round((m.get("siding_sqft") or 0) / 100.0, 1),
        "note": "Same SQ as siding",
    },
    {
        "section": "Siding Accessories",
        "item": "2\" Nails 30 lbs (1 per 15 Sq)",
        "unit": "JOB",
        "extract": lambda m: max(1, round((m.get("siding_sqft") or 0) / 100.0 / 15)),
        "note": "1 box per 15 SQ of siding",
    },
    # SOFFIT & FASCIA — auto-populate from HOVER soffit + eaves + rakes
    {
        "section": "Vinyl Soffit with Siding",
        "item": "Soffit & fascia up to 13\" wide Charter Oak",
        "unit": "LF",
        # Linear feet of eaves (fascia runs along eaves where soffit attaches).
        # If HOVER reports both eaves + rakes, we add them since both get soffit.
        "extract": lambda m: round((m.get("eaves_lf") or 0) + (m.get("rakes_lf") or 0)),
        "note": "Eaves LF + Rakes LF",
    },
    # MISC LABOR & MATERIAL — caps from HOVER window/door counts. We use the
    # classified counts (entry/patio/garage) from the LLM so the contractor
    # doesn't have to manually rebalance.
    {
        "section": "Misc. Labor & Material",
        "item": "Cap window",
        "unit": "Each",
        "extract": lambda m: int(m.get("window_count") or 0),
        "note": "1 per window from HOVER",
    },
    {
        "section": "Misc. Labor & Material",
        "item": "Cap entry door",
        "unit": "Each",
        "extract": lambda m: int(m.get("entry_door_count") or 0),
        "note": "1 per entry door (D-N prefix, < 72in wide)",
    },
    {
        "section": "Misc. Labor & Material",
        "item": "Cap patio door",
        "unit": "Each",
        "extract": lambda m: int(m.get("patio_door_count") or 0),
        "note": "1 per sliding glass / patio door (SGD-N / FD-N prefix)",
    },
    {
        "section": "Misc. Labor & Material",
        "item": "Cap single garage door",
        "unit": "Each",
        "extract": lambda m: int(m.get("garage_door_count") or 0),
        "note": "1 per garage door (OHD-N or ≥72×84in)",
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
  "siding_sqft": <total Facades Siding area, ft²>,
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
    reply = await chat.send_message(msg)
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
        out.append({
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
