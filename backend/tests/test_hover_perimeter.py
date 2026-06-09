"""Regression tests for the HOVER importer's auto-fill logic.

Currently focused on the Iter-47 perimeter→roll calculation for the
.019 Coil. Pytest-compatible; run from /app/backend with:
    pytest tests/test_hover_perimeter.py -v
"""
import sys
from pathlib import Path

# Ensure the backend package is on sys.path even when invoked from /app.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from routes.hover import HOVER_MAPPING_SPEC, _build_lines  # noqa: E402


def _coil_mapping():
    for m in HOVER_MAPPING_SPEC:
        if m.get("item") == "Windows - .019 Coil":
            return m
    raise AssertionError("Could not find .019 Coil mapping in HOVER_MAPPING_SPEC")


def test_coil_mapping_targets_both_window_brands():
    mapping = _coil_mapping()
    assert mapping["tabs"] == ["windows", "mezzo"]
    assert mapping["section"] == "Window Material List"
    assert mapping["unit"] == "ROLL"


def test_perimeter_three_windows():
    """3 windows: 36×60 (16 LF), 48×60 (18 LF), 30×48 (13 LF) = 47 LF total
    → 0.47 rolls."""
    mapping = _coil_mapping()
    qty = mapping["extract"]({
        "windows": [
            {"width_in": 36.0, "height_in": 60.0},
            {"width_in": 48.0, "height_in": 60.0},
            {"width_in": 30.0, "height_in": 48.0},
        ]
    })
    assert qty == 0.47


def test_perimeter_empty_inputs():
    mapping = _coil_mapping()
    assert mapping["extract"]({}) == 0.0
    assert mapping["extract"]({"windows": []}) == 0.0
    assert mapping["extract"]({"windows": None}) == 0.0


def test_perimeter_handles_missing_dimensions():
    """A window row with no width_in / height_in should contribute 0."""
    mapping = _coil_mapping()
    qty = mapping["extract"]({
        "windows": [
            {"width_in": 36.0, "height_in": 60.0},  # 16 LF
            {"width_in": None, "height_in": None},
            {},
        ]
    })
    assert qty == 0.16  # only the first window counts


def test_perimeter_large_batch_round_number():
    """15 windows @ 100×100in → each is 2×(100+100)/12 = 33.333… LF.
    Total 500 LF → exactly 5.00 rolls."""
    mapping = _coil_mapping()
    qty = mapping["extract"]({
        "windows": [{"width_in": 100, "height_in": 100}] * 15
    })
    assert qty == 5.0


def test_build_lines_emits_both_tabs():
    """`_build_lines` should produce a .019 Coil line for both windows
    AND mezzo tabs (so Vero and Mezzo job snapshots both see the trim)."""
    lines = _build_lines({
        "window_count": 2,
        "windows": [
            {"width_in": 36.0, "height_in": 60.0},   # 16 LF
            {"width_in": 48.0, "height_in": 72.0},   # 20 LF
        ],  # total 36 LF → 0.36 rolls
    })
    coil_lines = [ln for ln in lines if ln["name"] == "Windows - .019 Coil"]
    assert len(coil_lines) == 2, f"Expected 2 .019 Coil lines, got {len(coil_lines)}"
    tabs = {ln["tab"] for ln in coil_lines}
    assert tabs == {"windows", "mezzo"}
    for ln in coil_lines:
        assert ln["qty"] == 0.36
        assert ln["unit"] == "ROLL"
        assert ln["section"] == "Window Material List"


def test_build_lines_skips_coil_when_no_windows():
    """Zero perimeter → zero qty → line is suppressed by _build_lines."""
    lines = _build_lines({"window_count": 0, "windows": []})
    coil_lines = [ln for ln in lines if ln["name"] == "Windows - .019 Coil"]
    assert coil_lines == []
