"""Iter 78z — Profile callout classifier tests.

Howard's Campbell house surfaced the need: mixed-material houses
(LAP body + SHAKER gables + B&B dormers) were collapsing into a single
inflated lap line. The classifier maps raw callouts (text on blueprints
or visible patterns in photos) → canonical profile families so the
catalog mapper can split lines correctly.

Every callout that appeared on the Campbell blueprint AND the Campbell
actual material PO is locked in below as a regression test.
"""
import pytest

from profile_callouts import (
    classify_profile,
    is_non_siding_family,
    is_siding_family,
    label_for,
)


# ─── Empty / None handling ─────────────────────────────────────────
def test_empty_input_returns_empty_string():
    assert classify_profile("") == ""
    assert classify_profile(None) == ""
    assert classify_profile("   ") == ""


# ─── Dutch Lap variants (must beat plain "lap") ───────────────────
@pytest.mark.parametrize("text", [
    "DUTCH LAP",
    "Dutch Lap 5\"",
    "DUTCH LAP 4.5\"",
    "DL",
    "D4.5\"",
    "D 4\"",
    "D5",
    "dutch lap siding",
])
def test_dutch_lap_variants(text):
    assert classify_profile(text) == "dutch_lap"


# ─── Plain Lap variants ────────────────────────────────────────────
@pytest.mark.parametrize("text", [
    "LAP 4\"",
    "LAP 5\"",
    "lap siding",
    "clapboard",
    "Clap",
    "VINYL",                # bare "vinyl" defaults to lap
    "Vinyl Siding",
])
def test_lap_variants(text):
    assert classify_profile(text) == "lap"


# ─── Shake / Shaker family (Campbell's gable callout!) ────────────
@pytest.mark.parametrize("text", [
    "SHAKE",
    "Shake",
    "SHAKER",                # Campbell blueprint uses this exact word
    "Shaker",
    "SHINGLES",              # Claude's actual output on Campbell L/R gables
    "Shingle",
    "hand-split",
    "Hand Split Shake",       # matches Pelican Bay Hand-Split (Campbell PO)
    "HAND SPLIT",
    "scallop",
    "Scallop accent",
    "fish scale",
    "FISH SCALE",
])
def test_shake_variants(text):
    assert classify_profile(text) == "shake"


# ─── Generic "SIDING" callout (Campbell prints — body label) ──────
@pytest.mark.parametrize("text", [
    "SIDING",
    "Siding",
    "EXT SIDING",
    "EXTERIOR SIDING",
    "Ext Siding",
])
def test_generic_siding_defaults_to_lap(text):
    assert classify_profile(text) == "lap"


# ─── Board & Batten variants (Campbell's dormer / vertical accent) ─
@pytest.mark.parametrize("text", [
    "B&B",
    "BB",
    "Board and Batten",
    "BOARD AND BATTEN",
    "Board & Batten",
    "BNB",                    # matches "MAB BNB 14\"" on Campbell PO
    "MAB BNB 14\"",
    "ALS B&B VERTICAL SDG",   # Campbell PO line item
    "batten",
    "battened",
])
def test_board_batten_variants(text):
    assert classify_profile(text) == "board_batten"


# ─── Plain vertical (no batten) ────────────────────────────────────
@pytest.mark.parametrize("text", [
    "VERTICAL",
    "Vertical siding",
    "V/S",
    "V SDG",
])
def test_vertical_variants(text):
    assert classify_profile(text) == "vertical"


# ─── Nickel Gap ────────────────────────────────────────────────────
@pytest.mark.parametrize("text", [
    "Nickel Gap",
    "NICKEL GAP",
    "NG",
])
def test_nickel_gap_variants(text):
    assert classify_profile(text) == "nickel_gap"


# ─── Non-siding masonry (Campbell stone watertable!) ──────────────
@pytest.mark.parametrize("text", [
    "STONE",
    "Stone",
    "STONE WATERTABLE",       # Campbell blueprint
    "stonework",
    "WATERTABLE",
    "Water Table",
])
def test_stone_variants(text):
    family = classify_profile(text)
    assert family == "stone"
    assert is_non_siding_family(family) is True
    assert is_siding_family(family) is False


def test_brick_variants():
    assert classify_profile("BRICK") == "brick"
    assert classify_profile("brick wainscot") == "brick"


def test_stucco_variants():
    assert classify_profile("STUCCO") == "stucco"
    assert classify_profile("EIFS panel") == "stucco"


# ─── Unknown text — preserves typed info but doesn't generate a SKU ─
def test_unknown_text():
    assert classify_profile("zzzwhatever") == "unknown"


# ─── Precedence: Dutch Lap beats Lap, B&B beats Vertical ──────────
def test_dutch_lap_beats_lap():
    assert classify_profile("DUTCH LAP 5\" siding") == "dutch_lap"


def test_bb_beats_vertical():
    """'Board & Batten Vertical' should map to board_batten, not vertical."""
    assert classify_profile("Board and Batten Vertical") == "board_batten"


# ─── Helper predicates ──────────────────────────────────────────────
def test_is_siding_family():
    for fam in ("lap", "dutch_lap", "shake", "board_batten", "vertical", "nickel_gap"):
        assert is_siding_family(fam), f"{fam} should be siding"
    for fam in ("stone", "brick", "stucco", "unknown", ""):
        assert not is_siding_family(fam), f"{fam} should NOT be siding"


def test_human_labels():
    assert label_for("dutch_lap") == "Dutch Lap"
    assert label_for("board_batten") == "Board & Batten"
    assert label_for("shake") == "Shake"
    assert label_for("") == ""


# ─── Campbell-specific golden case ─────────────────────────────────
def test_campbell_blueprint_callouts():
    """Real-world callouts seen on the Campbell construction prints
    AND what Claude actually returns when we run the AI Blueprint
    endpoint on that PDF (verified 2026-02-13). If any of these
    regress, the per-elevation breakdown for that job is broken."""
    # Blueprint surface labels
    assert classify_profile("LAP 4\"") == "lap"
    assert classify_profile("SHAKER") == "shake"
    assert classify_profile("STONE WATERTABLE") == "stone"
    # Claude's verbatim output on the Campbell PDF
    assert classify_profile("SIDING") == "lap"     # body label, all 4 walls
    assert classify_profile("SHINGLES") == "shake" # Left + Right gables
    assert classify_profile("STONE") == "stone"    # all 4 stone callouts
