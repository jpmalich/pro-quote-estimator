"""Profile callout normalizer (Iter 78z).

Construction blueprints and AI vision passes return raw siding-profile
callout text (e.g. "LAP 4\"", "DUTCH LAP", "SHAKER", "B&B"). The catalog
SKU names are different and inconsistent across product lines, so we
need a translation layer.

This module owns the single source of truth for "raw text → canonical
profile family" mapping. It's used by:
  - routes/ai_measure.py   to interpret photo-based callouts
  - routes/ai_blueprint.py to interpret printed-plan callouts
  - the catalog mapper     to pick the right SKU for each line

Canonical profile families:
  "lap"          — horizontal lap siding (any width)
  "dutch_lap"    — horizontal dutch lap (notched profile)
  "shake"        — cedar shake / shaker / hand-split look
  "board_batten" — wide vertical board with batten strips
  "vertical"     — plain vertical (no batten)
  "nickel_gap"   — narrow V-groove vertical
  "stone"        — masonry watertable / wainscot (NOT siding)
  "brick"        — masonry brick (NOT siding)
  "stucco"       — stucco / EIFS (NOT siding)
  "unknown"      — text was present but couldn't be classified
  ""             — empty / not provided

Howard's directive (Iter 78z, 2026-02-13): mixed-material houses like
the Campbell job (lap on body + shaker on gables + B&B on dormers)
must produce SEPARATE quote lines per profile. This module enables
that classification.
"""
from __future__ import annotations
import re
from typing import Optional


# Each tuple: (regex pattern, canonical family). Order matters — first
# match wins, so put the more specific patterns first (e.g. "dutch lap"
# before bare "lap").
_PROFILE_PATTERNS: list[tuple[re.Pattern, str]] = [
    # NOT-siding masonry — checked first so a "STONE WATERTABLE" callout
    # never accidentally maps to anything else.
    (re.compile(r"\b(stone|stonework|watertable|water\s*table)\b", re.I), "stone"),
    (re.compile(r"\bbrick\b", re.I), "brick"),
    (re.compile(r"\b(stucco|eifs)\b", re.I), "stucco"),

    # Shake / Shaker family
    (re.compile(r"\b(shake|shaker|hand[\s-]?split|scallop|fish[\s-]?scale)\b", re.I), "shake"),

    # Board & Batten variants (B&B / BNB / batt + vertical context)
    (re.compile(r"\bboard\s*(?:and|&|\+|n)?\s*batten\b", re.I), "board_batten"),
    (re.compile(r"\bbnb\b", re.I), "board_batten"),
    (re.compile(r"\bb\s*&\s*b\b", re.I), "board_batten"),
    (re.compile(r"\bbb\b", re.I), "board_batten"),
    (re.compile(r"\bbatt(?:en)?(?:ed)?\b", re.I), "board_batten"),

    # Nickel Gap (vertical with tight V-groove)
    (re.compile(r"\bnickel\s*gap\b", re.I), "nickel_gap"),
    (re.compile(r"\bng\b", re.I), "nickel_gap"),

    # Plain vertical (no batten) — must come AFTER board_batten so B&B wins
    (re.compile(r"\bvertical\b", re.I), "vertical"),
    (re.compile(r"\bv/?\s*s(?:dg)?\b", re.I), "vertical"),  # V/S, V SDG

    # Dutch Lap — checked BEFORE plain "lap"
    (re.compile(r"\bdutch\s*lap\b", re.I), "dutch_lap"),
    (re.compile(r"\bdl\b", re.I), "dutch_lap"),
    (re.compile(r"\bd\s*4(?:\.5)?\"?\b", re.I), "dutch_lap"),  # "D4.5" / "D 4"
    (re.compile(r"\bd\s*5\"?\b", re.I), "dutch_lap"),

    # Horizontal Lap (plain "lap" or "clapboard")
    (re.compile(r"\b(clap(?:board)?|lap)\b", re.I), "lap"),

    # Just "vinyl" — assume horizontal lap (no profile hint)
    (re.compile(r"\bvinyl\b", re.I), "lap"),
]


def classify_profile(callout_text: Optional[str]) -> str:
    """Map raw callout text to a canonical profile family.

    Returns one of: "lap", "dutch_lap", "shake", "board_batten",
    "vertical", "nickel_gap", "stone", "brick", "stucco", "unknown",
    or "" (empty input).
    """
    if not callout_text:
        return ""
    text = str(callout_text).strip()
    if not text:
        return ""
    for pattern, family in _PROFILE_PATTERNS:
        if pattern.search(text):
            return family
    return "unknown"


def is_non_siding_family(family: str) -> bool:
    """True for families that are NOT siding (masonry, stucco). These
    should NOT generate a siding line item in the catalog mapper, but
    they DO reduce the siding ft² on that elevation."""
    return family in {"stone", "brick", "stucco"}


def is_siding_family(family: str) -> bool:
    """True for canonical siding profiles (lap, shake, B&B, etc.).
    `unknown` returns False so an unclassifiable callout doesn't
    silently produce a wrong SKU line."""
    return family in {
        "lap", "dutch_lap", "shake", "board_batten",
        "vertical", "nickel_gap",
    }


# Human-readable label for UI badges / debug logs.
PROFILE_LABELS = {
    "lap":          "Lap",
    "dutch_lap":    "Dutch Lap",
    "shake":        "Shake",
    "board_batten": "Board & Batten",
    "vertical":     "Vertical",
    "nickel_gap":   "Nickel Gap",
    "stone":        "Stone",
    "brick":        "Brick",
    "stucco":       "Stucco",
    "unknown":      "Unknown profile",
    "":             "",
}


def label_for(family: str) -> str:
    return PROFILE_LABELS.get(family, family)
