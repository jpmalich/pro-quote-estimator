"""Iter 78ab — LP SmartSide AI auto-population formula tests.

Covers the new `lp_smartside_formulas` module + flag-aware wiring into
`routes/hover._build_lines`. Tests run with the flag both OFF (legacy
behavior preserved) and ON (PDF-accurate formulas active).

PDF source: LP_SmartSide_Reference.pdf (Howard, 2026-02-28).
"""
from __future__ import annotations
import math
import sys
from pathlib import Path

import pytest

# Make the backend package importable when running pytest from /app
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / ".env")

import lp_smartside_formulas as lp  # noqa: E402
from routes.hover import _build_lines, _lp_profile_sku_entry  # noqa: E402


# ────────────────────── Helpers ──────────────────────

@pytest.fixture
def flag_off(monkeypatch):
    monkeypatch.setenv("LP_AI_FORMULAS_V1", "false")
    yield


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv("LP_AI_FORMULAS_V1", "true")
    yield


def _lp_lines(lines: list[dict]) -> list[dict]:
    return [ln for ln in lines if ln.get("tab") == "lp_smart"]


def _find(lines, item):
    return next((ln for ln in lines if ln.get("name") == item), None)


# ────────────────────── Pure-formula tests ──────────────────────

def test_is_enabled_default_off(monkeypatch):
    monkeypatch.delenv("LP_AI_FORMULAS_V1", raising=False)
    assert lp.is_enabled() is False


def test_is_enabled_on(monkeypatch):
    monkeypatch.setenv("LP_AI_FORMULAS_V1", "true")
    assert lp.is_enabled() is True


def test_lap_coverage_default_is_8_inch():
    """Default lap profile is 8" Lap per Howard (2026-02-28). PDF says
    9.17 sqft/board for 8" Lap."""
    assert lp.lap_coverage_sqft_per_pc() == 9.17
    assert lp.lap_coverage_sqft_per_pc("8\" Lap") == 9.17
    assert lp.lap_coverage_sqft_per_pc("12\" Lap") == 14.50


def test_soffit_default_is_16_inch():
    """Default soffit panel is 16" per Howard. PDF: 21.3 sqft/panel."""
    assert lp.soffit_coverage_sqft_per_pc() == 21.3
    assert lp.soffit_coverage_sqft_per_pc("12\" Soffit") == 15.9
    assert lp.soffit_coverage_sqft_per_pc("24\" Soffit") == 31.9


def test_shake_default_reveal_is_7_inches():
    """Default reveal is 7" per Howard. PDF: 2.33 sqft/panel at 7"."""
    assert lp.DEFAULT_SHAKE_REVEAL_INCHES == 7.0
    assert lp.shake_coverage_sqft_per_pc(7.0) == 2.33
    assert lp.shake_coverage_sqft_per_pc(8.0) == 2.67


def test_shake_reveal_clamps_to_pdf_bounds():
    """Anything outside the 6-7/8" to 9-7/8" range gets clamped."""
    assert lp.shake_coverage_sqft_per_pc(4.0) == lp.shake_coverage_sqft_per_pc(6.875)
    assert lp.shake_coverage_sqft_per_pc(12.0) == lp.shake_coverage_sqft_per_pc(9.875)


def test_nickel_gap_fixed_coverage():
    """Nickel Gap is fixed 7" reveal on 16' boards → 9.33 sqft/board."""
    assert lp.NICKEL_GAP_COVERAGE_SQFT_PER_PC == 9.33
    # 1000 sqft wall: ceil(1000/9.33 * 1.10) = ceil(117.9...) = 118
    assert lp.nickel_gap_pieces(1000) == 118


def test_lap_pieces_applies_10pct_waste_and_round_up():
    """1000 sqft @ 8" Lap (9.17 sqft/pc): ceil(1000/9.17 * 1.10) =
    ceil(119.96...) = 120 pieces."""
    assert lp.lap_pieces(1000, "8\" Lap") == 120
    # 8" lap example: 100 sqft = ceil(100/9.17 * 1.10) = 12
    assert lp.lap_pieces(100) == 12


def test_shake_pieces_at_7in_reveal():
    """1000 sqft of shake at 7": ceil(1000/2.33 * 1.10) = ceil(472.1) = 473."""
    assert lp.shake_pieces(1000, 7.0) == 473


def test_bb_panel_pieces_uses_40_sqft():
    """B&B panel is 4x10 = 40 sqft (PDF). 200 sqft → ceil(200/40 * 1.10) = 6."""
    assert lp.board_batten_panel_pieces(200) == 6
    assert lp.board_batten_panel_pieces(0) == 0


def test_batten_pieces_default_16_inch_oc():
    """100 sqft @ 16" o.c.: batten_LF = 100 × 0.75 = 75. With 10% waste
    and 16' stock: ceil(75 × 1.10 / 16) = ceil(5.16) = 6 pieces."""
    assert lp.board_batten_batten_pieces(100) == 6


def test_batten_pieces_24_inch_oc_uses_50_lf():
    """24" o.c. yields 50 LF per 100 sqft: ceil(50 × 1.10 / 16) = 4."""
    assert lp.board_batten_batten_pieces(100, "24\" o.c.") == 4


def test_batten_pieces_12_inch_oc_doubles_lf():
    """12" o.c. doubles LF vs 24". Use a large enough wall to ride above
    ceil-rounding noise — 1000 sqft makes the ratio exact."""
    pcs_12 = lp.board_batten_batten_pieces(1000, "12\" o.c.")
    pcs_24 = lp.board_batten_batten_pieces(1000, "24\" o.c.")
    # 12" o.c.: 1000 LF × 1.10 / 16 = 68.75 → 69
    # 24" o.c.: 500 LF × 1.10 / 16 = 34.375 → 35
    # Ratio ~2× modulo rounding.
    assert 1.9 <= pcs_12 / pcs_24 <= 2.1


def test_shake_540_bump_two_pieces_per_100sqft():
    assert lp.shake_540_series_bump(0) == 0
    assert lp.shake_540_series_bump(50) == 1   # ceil(0.5 * 2) = 1
    assert lp.shake_540_series_bump(100) == 2
    assert lp.shake_540_series_bump(250) == 5  # ceil(2.5 * 2) = 5


# ────────────────────── Integration with hover._build_lines ──────────────────────

def test_legacy_lp_lap_when_flag_off(flag_off):
    """Flag OFF: 1000 sqft default-siding row stays at the legacy
    `sqft × 0.11` (≈ 110 pcs)."""
    m = {"siding_with_openings_sqft": 1000}
    lines = _build_lines(m)
    lap = _find(_lp_lines(lines), '38 Series Lap 3/8" x 8" x 16\'')
    assert lap is not None
    # 1000 * 0.11 = 110 → rounded
    assert lap["qty"] == 110


def test_lp_lap_uses_pdf_formula_when_flag_on(flag_on):
    """Flag ON: same 1000 sqft now lands at 120 pcs (PDF 8" Lap formula
    with 10% waste). Slightly higher than the legacy 110 — that's the
    intended correction."""
    m = {"siding_with_openings_sqft": 1000}
    lines = _build_lines(m)
    lap = _find(_lp_lines(lines), '38 Series Lap 3/8" x 8" x 16\'')
    assert lap is not None
    assert lap["qty"] == 120


def test_per_profile_lp_shake_qty_with_flag_on(flag_on):
    """Multi-profile breakdown: 500 sqft shake @ 7" reveal should land
    at 237 pcs (ceil(500/2.33 × 1.10))."""
    m = {
        "_per_profile_sqft": {"lap": 600, "shake": 500},
        "siding_with_openings_sqft": 1100,
    }
    lines = _build_lines(m)
    lp_shake = _find(_lp_lines(lines), "Shake")
    assert lp_shake is not None
    assert lp_shake["qty"] == 237


def test_per_profile_lp_shake_qty_with_flag_off(flag_off):
    """Legacy: same shake breakdown lands at the rounded-1-dec qty
    `500 / 9.09 ≈ 55.0` (much lower — under-counts shakes)."""
    m = {
        "_per_profile_sqft": {"lap": 600, "shake": 500},
        "siding_with_openings_sqft": 1100,
    }
    lines = _build_lines(m)
    lp_shake = _find(_lp_lines(lines), "Shake")
    assert lp_shake is not None
    assert lp_shake["qty"] == pytest.approx(55.0, rel=0.01)


def test_540_series_includes_shake_bump_when_flag_on(flag_on):
    """1000 sqft shake on a 5-window house: 540 Series qty should =
    base (windows wrap) + 20 belly-band pieces."""
    m = {
        "window_count": 5,
        "_per_profile_sqft": {"shake": 1000},
        "siding_with_openings_sqft": 1000,
    }
    lines = _build_lines(m)
    t540 = _find(_lp_lines(lines), '540 Series Trim 5/4" x 4" x 16\'')
    assert t540 is not None
    base = math.ceil(5 * 14 / 16)  # = 5
    bump = lp.shake_540_series_bump(1000)  # = 20
    assert t540["qty"] == base + bump


def test_540_series_no_bump_when_flag_off(flag_off):
    """Same payload, flag OFF: 540 Series stays at the legacy formula
    without the shake bump."""
    m = {
        "window_count": 5,
        "_per_profile_sqft": {"shake": 1000},
    }
    lines = _build_lines(m)
    t540 = _find(_lp_lines(lines), '540 Series Trim 5/4" x 4" x 16\'')
    assert t540 is not None
    assert t540["qty"] == math.ceil(5 * 14 / 16)  # 5


def test_190_series_battens_only_emitted_when_bb_present_and_flag_on(flag_on):
    """B&B breakdown present + flag ON → 190 Series row emitted."""
    m = {
        "_per_profile_sqft": {"board_batten": 400},
        "siding_with_openings_sqft": 400,
    }
    lines = _build_lines(m)
    batten = _find(_lp_lines(lines), '190 Series Trim 19/32" x 3" x 16\'')
    assert batten is not None
    # 400 sqft @ 16" o.c.: LF = 400 * 0.75 = 300; pcs = ceil(300*1.10/16) = 21
    assert batten["qty"] == 21


def test_190_series_battens_skipped_when_flag_off(flag_off):
    """B&B breakdown but flag OFF — 190 Series row must NOT appear."""
    m = {"_per_profile_sqft": {"board_batten": 400}}
    lines = _build_lines(m)
    batten = _find(_lp_lines(lines), '190 Series Trim 19/32" x 3" x 16\'')
    assert batten is None


def test_190_series_battens_skipped_when_no_bb_profile(flag_on):
    """Flag ON, but no B&B in the breakdown → no 190 Series row."""
    m = {"_per_profile_sqft": {"lap": 800}}
    lines = _build_lines(m)
    batten = _find(_lp_lines(lines), '190 Series Trim 19/32" x 3" x 16\'')
    assert batten is None


def test_lp_profile_sku_entry_falls_back_when_flag_off(flag_off):
    assert _lp_profile_sku_entry("lap") is None
    assert _lp_profile_sku_entry("shake") is None


def test_lp_profile_sku_entry_returns_pdf_values_when_flag_on(flag_on):
    lap = _lp_profile_sku_entry("lap")
    assert lap is not None
    assert lap[0] == '38 Series Lap 3/8" x 8" x 16\''
    assert lap[2] == pytest.approx(9.17)
    shake = _lp_profile_sku_entry("shake")
    assert shake is not None
    assert shake[2] == pytest.approx(2.33)
    bb = _lp_profile_sku_entry("board_batten")
    assert bb is not None
    assert bb[2] == 40.0


# ────────────────────── Defaults match Howard's spec (2026-02-28) ──────────────────────

def test_pdf_defaults_match_howards_spec():
    """Final guardrail — if anyone changes the default profiles, this
    test catches it. Howard's spec (2026-02-28): 8" Lap / 16" Soffit /
    7" shake reveal."""
    assert lp.DEFAULT_LAP_PROFILE == "8\" Lap"
    assert lp.DEFAULT_SOFFIT_WIDTH == "16\" Soffit"
    assert lp.DEFAULT_SHAKE_REVEAL_INCHES == 7.0
    assert lp.DEFAULT_WASTE == 0.10
