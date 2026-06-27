"""Iter 78z+++ — Safety-net recompute for sentinel-50 annotation boxes.

ProfileAnnotator defaults a new box's sqft to 50 when no scale is set.
If the user later sets scale (or auto-OCR fires) but a re-compute on
the client got skipped before persistence, the box still lands at 50.

`apply_annotations_to_breakdown` now treats sqft≈50 + a present
scale_ref as "recompute server-side from geometry". This test pins
that behavior so we never silently leak a 50-ft² Shake / B&B / etc.
into a contractor's materials list.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from profile_callouts import (  # noqa: E402
    _recompute_box_sqft,
    apply_annotations_to_breakdown,
)


def _make_breakdown():
    """Bare-bones per-elevation breakdown matching the real shape."""
    return {
        "per_elevation": [
            {
                "label": "front",
                "wall_body_sqft": 600.0,
                "wall_body_profile": "lap",
                "wall_body_callout": "LAP 4\"",
                "gable_sqft": 0.0,
                "gable_profile": "",
                "gable_callout": "",
                "dormer_sqft": 0.0,
                "dormer_profile": "",
                "dormer_callout": "",
                "accents": [],
                "stone_sqft": 0.0,
                "stone_callout": "",
            }
        ],
        "per_profile_sqft": {"lap": 600.0},
    }


def _scale_ref():
    """A typical Page-2 calibration: a 6.67 ft door projected to 100
    display pixels of height, on an 800x600 displayed blueprint."""
    return {
        "px_height": 100.0,
        "real_ft": 6.67,
        "img_w": 800.0,
        "img_h": 600.0,
    }


# ---------------------------------------------------------------------------
# Helper: _recompute_box_sqft
# ---------------------------------------------------------------------------
def test_recompute_rect_box_uses_scale_ref():
    """A 0.25w × 0.5h rect at 800x600 display, scale 100px = 6.67 ft,
    should yield ~(200px * 0.0667) ft * (300px * 0.0667) ft."""
    box = {"shape": "rect", "w_norm": 0.25, "h_norm": 0.5}
    sqft = _recompute_box_sqft(box, _scale_ref())
    assert sqft is not None
    # ft_per_px = 6.67/100 = 0.0667 → w = 200*0.0667 = 13.34 ft,
    # h = 300*0.0667 = 20.01 ft, sqft = 13.34 * 20.01 = ~266.93
    assert 260.0 < sqft < 275.0


def test_recompute_polygon_box_uses_shoelace():
    """Triangle polygon with normalized verts (0,0), (0.5,0), (0,0.5)
    at 800x600 = 400px wide × 300px tall right-triangle, area =
    400*300/2 = 60000 px², × ft_per_px² (0.0667²) ≈ 266.93 sqft."""
    box = {
        "shape": "polygon",
        "points": [
            {"x_norm": 0.0, "y_norm": 0.0},
            {"x_norm": 0.5, "y_norm": 0.0},
            {"x_norm": 0.0, "y_norm": 0.5},
        ],
    }
    sqft = _recompute_box_sqft(box, _scale_ref())
    assert sqft is not None
    assert 260.0 < sqft < 275.0


def test_recompute_returns_none_when_scale_ref_missing_dims():
    """Older annotations might have scale_refs without img_w/img_h
    (pre-Iter-78z+++). Recompute must bail (None) rather than divide
    by zero so the original sqft is kept."""
    ref = {"px_height": 100.0, "real_ft": 6.67}  # no img_w/img_h
    box = {"shape": "rect", "w_norm": 0.25, "h_norm": 0.5}
    assert _recompute_box_sqft(box, ref) is None


def test_recompute_returns_none_for_degenerate_polygon():
    """Two-point polygon has zero area; recompute must return None."""
    box = {
        "shape": "polygon",
        "points": [{"x_norm": 0, "y_norm": 0}, {"x_norm": 0.5, "y_norm": 0}],
    }
    assert _recompute_box_sqft(box, _scale_ref()) is None


# ---------------------------------------------------------------------------
# Integration: apply_annotations_to_breakdown rewrites sentinel-50
# ---------------------------------------------------------------------------
def test_apply_annotations_rewrites_sentinel_50_with_scale_ref():
    """Box arrives at sqft=50 (sentinel default) with a scale_ref for
    its page → the merged accent uses the recomputed real sqft, not 50."""
    annotations = {
        "0": [
            {
                "shape": "rect",
                "elevation_label": "front",
                "profile": "shake",
                "callout": "Shake gable",
                "sqft": 50.0,  # sentinel default
                "w_norm": 0.25,
                "h_norm": 0.5,
            }
        ],
        "_scale_refs": {"0": _scale_ref()},
    }
    out = apply_annotations_to_breakdown(_make_breakdown(), annotations)
    accents = (out["per_elevation"][0].get("accents") or [])
    assert len(accents) == 1
    # Recomputed sqft should be ~266.93, NOT the sentinel 50
    assert accents[0]["sqft"] > 200.0


def test_apply_annotations_keeps_user_overridden_sqft():
    """When the user typed a custom sqft (e.g. 175) it's NOT the
    sentinel 50, so the safety-net is bypassed and we trust the user."""
    annotations = {
        "0": [
            {
                "shape": "rect",
                "elevation_label": "front",
                "profile": "shake",
                "sqft": 175.0,  # user override, NOT the sentinel
                "w_norm": 0.25,
                "h_norm": 0.5,
            }
        ],
        "_scale_refs": {"0": _scale_ref()},
    }
    out = apply_annotations_to_breakdown(_make_breakdown(), annotations)
    accents = out["per_elevation"][0]["accents"]
    assert len(accents) == 1
    assert accents[0]["sqft"] == 175.0


def test_apply_annotations_keeps_sentinel_50_when_no_scale_ref():
    """No scale_ref → safety-net can't recompute; original 50 stays.
    Backwards-compat with annotations saved before scale was added."""
    annotations = {
        "0": [
            {
                "shape": "rect",
                "elevation_label": "front",
                "profile": "shake",
                "sqft": 50.0,
                "w_norm": 0.25,
                "h_norm": 0.5,
            }
        ],
        # no _scale_refs key
    }
    out = apply_annotations_to_breakdown(_make_breakdown(), annotations)
    accents = out["per_elevation"][0]["accents"]
    assert len(accents) == 1
    assert accents[0]["sqft"] == 50.0


def test_apply_annotations_recomputes_polygon_sentinel_50():
    """Polygon path also benefits from the safety net."""
    annotations = {
        "0": [
            {
                "shape": "polygon",
                "elevation_label": "front",
                "profile": "board_batten",
                "sqft": 50.0,
                "points": [
                    {"x_norm": 0.0, "y_norm": 0.0},
                    {"x_norm": 0.5, "y_norm": 0.0},
                    {"x_norm": 0.5, "y_norm": 0.5},
                    {"x_norm": 0.0, "y_norm": 0.5},
                ],
            }
        ],
        "_scale_refs": {"0": _scale_ref()},
    }
    out = apply_annotations_to_breakdown(_make_breakdown(), annotations)
    accents = out["per_elevation"][0]["accents"]
    assert len(accents) == 1
    # 0.5*0.5 polygon at 800x600 = 400*300 = 120000 px² → ~533.86 sqft
    assert accents[0]["sqft"] > 400.0


# ---------------------------------------------------------------------------
# Iter 78z+++ — structured `location` field (body/gable/dormer/porch/trim/other)
# routes through to the accent entry. Lets one elevation row carry mixed
# accents — Lap on body + Shake on gable + B&B on dormer — without
# splitting elevations.
# ---------------------------------------------------------------------------
def test_apply_annotations_uses_structured_location_field():
    """When the new `location` dropdown is set (e.g. "dormer"), the
    accent's `location` field reflects it, not the free-text callout."""
    annotations = {
        "0": [
            {
                "shape": "rect",
                "elevation_label": "front",
                "profile": "shake",
                "sqft": 120.0,
                "location": "dormer",
                "callout": "north dormer face",
            }
        ],
    }
    out = apply_annotations_to_breakdown(_make_breakdown(), annotations)
    accents = out["per_elevation"][0]["accents"]
    assert len(accents) == 1
    assert accents[0]["location"] == "dormer"
    # callout free-text preserved separately
    assert accents[0]["callout"] == "north dormer face"


def test_apply_annotations_falls_back_to_callout_when_no_location():
    """Pre-78z+++ annotations without a `location` field still route
    via the free-text callout (backwards compat)."""
    annotations = {
        "0": [
            {
                "shape": "rect",
                "elevation_label": "front",
                "profile": "board_batten",
                "sqft": 80.0,
                "callout": "gable",
            }
        ],
    }
    out = apply_annotations_to_breakdown(_make_breakdown(), annotations)
    accents = out["per_elevation"][0]["accents"]
    assert len(accents) == 1
    assert accents[0]["location"] == "gable"


def test_dormer_elevation_label_creates_synthetic_row():
    """Tagging a box on the new 'dormer' elevation creates a synthetic
    elevation row when Claude didn't surface one (parity with existing
    porch/other behavior)."""
    annotations = {
        "0": [
            {
                "shape": "rect",
                "elevation_label": "dormer",
                "profile": "shake",
                "sqft": 65.0,
                "location": "dormer",
            }
        ],
    }
    out = apply_annotations_to_breakdown(_make_breakdown(), annotations)
    labels = [e["label"] for e in out["per_elevation"]]
    assert "dormer" in labels
    dormer_row = next(e for e in out["per_elevation"] if e["label"] == "dormer")
    assert len(dormer_row["accents"]) == 1
    assert dormer_row["accents"][0]["sqft"] == 65.0
