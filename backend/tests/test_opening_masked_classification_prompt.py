"""Iter 79j.32 — Regression guard for the opening-vs-masked prompt rule.

Howard hit a bug where Claude was dumping 144 ft² of garage doors + entry
door on the front wall into the `stone/masked` bucket (via a low
`siding_pct_this_wall`), which silently dropped ~40 lf of J-channel per
garage door from the takeoff.

The fix is a strengthened SYSTEM_PROMPT that explicitly separates
MASKED (masonry) from OPENINGS (windows, doors, garage doors). This test
asserts the key phrases stay in the prompt so a future refactor doesn't
silently regress the classification.
"""
from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
sys.path.insert(0, "/app/backend/routes")
load_dotenv(Path("/app/backend/.env"))

from routes.ai_measure import SYSTEM_PROMPT  # noqa: E402


def test_prompt_calls_out_openings_bucket_explicitly():
    """Every trimmed penetration MUST be classified as an opening,
    not folded into masked/stone area. Assertions target the exact
    guidance the LLM needs to see for the fix to hold."""
    p = SYSTEM_PROMPT
    # Header of the new rule
    assert "MASKED vs OPENINGS" in p, (
        "Prompt lost the MASKED vs OPENINGS heading — the LLM will "
        "revert to dumping doors into stone/masked."
    )
    # Explicit garage-door callout
    assert "garage_door" in p.lower() or "garage door" in p.lower()
    # The forbidden regression pattern (accept either single-line or
    # line-wrapped variants; the intent is that the strong garage-door
    # warning survives regardless of formatting).
    p_flat = " ".join(p.split())
    assert "GARAGE DOORS ARE ESPECIALLY EASY TO GET WRONG" in p_flat, (
        "The garage-door warning block is missing — this is the exact "
        "misclassification Howard reported (144 ft² + ~40 lf J-channel "
        "per door disappeared into stone/masked)."
    )
    assert "ALWAYS emit garage" in p_flat
    # Decision tree must survive
    assert "Decision tree per non-siding region" in p


def test_prompt_reserves_siding_pct_for_masonry_only():
    """siding_pct_this_wall must only be reduced by real masonry,
    never by openings — otherwise J-channel drops."""
    p = SYSTEM_PROMPT
    assert "MASKED / NON-SIDING (drives `siding_pct_this_wall` DOWN)" in p
    assert "OPENINGS (belong in `openings[]`, DO NOT reduce siding_pct)" in p


def test_prompt_no_longer_flags_garage_doors_as_no_siding_zone():
    """The old 'NO SIDING · Garage door' annotation guidance implied
    garage doors reduced siding coverage. The updated prompt must
    explicitly route those to openings[] instead."""
    p = SYSTEM_PROMPT
    # The bad phrasing ("NO SIDING · Garage door" in the trio) is gone
    assert 'or "NO SIDING · Garage door" — these areas' not in p, (
        "Old annotation guidance still lists 'NO SIDING · Garage door' "
        "as a masked zone — that's the recurrence path."
    )
    # And the new note is present
    assert "Iter 79j.32" in p
    assert "doors are OPENINGS, not masked masonry" in p


def test_prompt_still_treats_masonry_as_masked():
    """We didn't want to over-correct — real masonry must still land
    in the masked bucket."""
    p = SYSTEM_PROMPT
    # The MASKED bucket still enumerates masonry
    assert "Brick or stone wainscot / watertable" in p
    assert "Stucco / EIFS panel sections" in p
