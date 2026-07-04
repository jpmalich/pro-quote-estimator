"""Iter 79j.26 + 79j.27 — apply_roof_type_material_math (roof-type-aware
walls[] normalization).

Acceptance check for the red-house dormer scenario:
  * When Claude classifies the roof as gable-shed-dormer at ≥0.8 confidence
    and marks 2 openings with on_dormer=true, the front wall's
    dormer_face_sqft grows by (dormer face + cheeks − 2 dormer window
    cutouts). Main-wall opening count is untouched (all 6 openings still
    live in raw.openings — the frontend uses on_dormer=true to split them
    for display).
  * When the roof is classified as hip at ≥0.8 confidence, every wall's
    gable_triangle_height_ft is zeroed.

Direct unit tests against apply_roof_type_material_math — no HTTP, no LLM.
"""
import sys
from pathlib import Path

import pytest
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
sys.path.insert(0, "/app/backend/routes")
load_dotenv(Path("/app/backend/.env"))

from routes.ai_measure import apply_roof_type_material_math  # noqa: E402


def _base_walls():
    """4 walls: front + back rectangular; left + right gable ends with 8ft triangle."""
    return [
        {"label": "front", "width_ft": 30, "height_ft": 10, "gable_triangle_height_ft": 0,
         "dormer_face_sqft": 0},
        {"label": "back", "width_ft": 30, "height_ft": 10, "gable_triangle_height_ft": 0,
         "dormer_face_sqft": 0},
        {"label": "left", "width_ft": 24, "height_ft": 10, "gable_triangle_height_ft": 8,
         "dormer_face_sqft": 0},
        {"label": "right", "width_ft": 24, "height_ft": 10, "gable_triangle_height_ft": 8,
         "dormer_face_sqft": 0},
    ]


def _red_house_openings():
    """4 main-wall windows on front + 2 dormer windows above the eave."""
    return [
        {"type": "window", "width_in": 36, "height_in": 60, "wall": "front", "on_dormer": False},
        {"type": "window", "width_in": 36, "height_in": 60, "wall": "front", "on_dormer": False},
        {"type": "window", "width_in": 36, "height_in": 60, "wall": "front", "on_dormer": False},
        {"type": "window", "width_in": 36, "height_in": 60, "wall": "front", "on_dormer": False},
        {"type": "window", "width_in": 30, "height_in": 42, "wall": "front", "on_dormer": True},
        {"type": "window", "width_in": 30, "height_in": 42, "wall": "front", "on_dormer": True},
    ]


def _raw(roof_type, roof_conf, dormer=None, openings=None):
    return {
        "roof_type": roof_type,
        "roof_type_confidence": roof_conf,
        "dormer": dormer,
        "openings": openings if openings is not None else _red_house_openings(),
    }


def test_red_house_dormer_deducts_opening_area_from_face():
    """Acceptance: dormer=10ft × 5ft knee + 2 windows @ 30"×42" each.

    face_sqft  = 10 × 5 = 50
    cheeks     = 2 × 0.5 × 5 × 5 = 25
    2 windows  = 2 × (30/12 × 42/12) = 2 × 8.75 = 17.5
    extra      = 50 + 25 − 17.5 = 57.5

    Total openings in raw remain 6 (dormer classification is
    frontend-only for display; backend keeps them for J-channel + trim).
    """
    walls = _base_walls()
    dormer = {"face": "front", "width_ft": 10, "knee_wall_height_ft": 5}
    raw = _raw("gable-shed-dormer", 0.9, dormer=dormer)
    _, dormer_sqft = apply_roof_type_material_math(raw, walls, gable_sqft=200.0, dormer_sqft=0.0)
    front = next(w for w in walls if w["label"] == "front")
    assert front["dormer_face_sqft"] == pytest.approx(57.5, abs=0.1)
    assert dormer_sqft == pytest.approx(57.5, abs=0.1)
    # opening_count contract: all 6 openings still in raw for perimeter/J-channel
    assert len(raw["openings"]) == 6
    # Dormer openings are still tagged on_dormer=true so the frontend
    # can filter them out of the main wall's display count (→ main front
    # wall shows 4 openings, dormer face shows 2, total across scene = 6)
    assert sum(1 for o in raw["openings"] if o["on_dormer"]) == 2
    assert sum(1 for o in raw["openings"] if not o["on_dormer"]) == 4


def test_gable_shed_dormer_low_conf_skips_math():
    walls = _base_walls()
    dormer = {"face": "front", "width_ft": 10, "knee_wall_height_ft": 5}
    raw = _raw("gable-shed-dormer", 0.4, dormer=dormer)
    apply_roof_type_material_math(raw, walls, 200.0, 0.0)
    front = next(w for w in walls if w["label"] == "front")
    assert front["dormer_face_sqft"] == 0, "low-conf must not touch material math"


def test_hip_zeros_gable_triangles():
    walls = _base_walls()
    raw = _raw("hip", 0.9)
    g, d = apply_roof_type_material_math(raw, walls, 200.0, 0.0)
    for w in walls:
        assert w["gable_triangle_height_ft"] == 0, f"hip must zero gable on {w['label']}"
    assert g == 0.0, "hip must zero gable_sqft summary"
    assert d == 0.0


def test_hip_low_conf_preserves_gables():
    walls = _base_walls()
    raw = _raw("hip", 0.5)
    apply_roof_type_material_math(raw, walls, 200.0, 0.0)
    left = next(w for w in walls if w["label"] == "left")
    assert left["gable_triangle_height_ft"] == 8, "low-conf hip must not zero gable"


def test_gable_at_high_conf_is_no_op():
    walls = _base_walls()
    raw = _raw("gable", 0.95)
    g, d = apply_roof_type_material_math(raw, walls, 200.0, 0.0)
    assert g == 200.0
    assert d == 0.0
    left = next(w for w in walls if w["label"] == "left")
    assert left["gable_triangle_height_ft"] == 8, "gable at high conf must not touch walls"


def test_dormer_with_no_on_dormer_openings_still_inflates():
    """Contractor drops a dormer classification but Claude didn't tag any
    windows on it — still inflate by the full face + cheeks (no deduction)."""
    walls = _base_walls()
    dormer = {"face": "front", "width_ft": 10, "knee_wall_height_ft": 5}
    raw = _raw("gable-shed-dormer", 0.9, dormer=dormer, openings=[])
    _, dormer_sqft = apply_roof_type_material_math(raw, walls, 200.0, 0.0)
    front = next(w for w in walls if w["label"] == "front")
    # face 50 + cheeks 25 = 75, no deduction
    assert front["dormer_face_sqft"] == pytest.approx(75.0, abs=0.1)
    assert dormer_sqft == pytest.approx(75.0, abs=0.1)


def test_bogus_roof_type_is_ignored():
    walls = _base_walls()
    raw = _raw("mansard", 0.99)   # not one of our 3 supported types
    g, d = apply_roof_type_material_math(raw, walls, 42.0, 7.0)
    assert g == 42.0
    assert d == 7.0
    left = next(w for w in walls if w["label"] == "left")
    assert left["gable_triangle_height_ft"] == 8


def test_confidence_boundary_at_exactly_0_8():
    """Threshold is ≥0.8, not >0.8 — boundary case."""
    walls = _base_walls()
    raw = _raw("hip", 0.8)
    apply_roof_type_material_math(raw, walls, 200.0, 0.0)
    left = next(w for w in walls if w["label"] == "left")
    assert left["gable_triangle_height_ft"] == 0, "exactly 0.8 must apply the math"
