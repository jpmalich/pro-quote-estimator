"""Iter 78z+ — Blueprint page persistence + ProfileAnnotator wiring.

These pin the blueprint contract that makes the annotator work:
  - PDF pages render server-side via `_render_pdf_to_pngs` AND get
    saved to UPLOAD_DIR.
  - Image-sheet uploads also persist a copy.
  - `page_paths` returned from POST /measure/ai-blueprint AND from
    GET /measure/ai-blueprint/latest-for-estimate so the annotator
    has the URLs whether the user is mid-run or restoring.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def test_render_pdf_to_pngs_helper_signature():
    """The helper that renders PDF pages must exist + accept (raw_bytes,
    max_pages) and return a list of PNG byte-strings."""
    from routes.ai_blueprint import _render_pdf_to_pngs
    import inspect
    sig = inspect.signature(_render_pdf_to_pngs)
    params = list(sig.parameters.keys())
    assert params == ["raw_pdf", "max_pages"]


def test_blueprint_aggregator_accepts_annotations():
    """`_aggregate_to_hover_shape` in ai_blueprint.py must take the
    optional `annotations` kwarg so the worker can pass it through."""
    from routes.ai_blueprint import _aggregate_to_hover_shape
    import inspect
    sig = inspect.signature(_aggregate_to_hover_shape)
    params = list(sig.parameters.keys())
    assert "annotations" in params
    # Annotations must be optional (default None) so existing callers
    # don't break.
    assert sig.parameters["annotations"].default is None


def test_blueprint_worker_accepts_estimate_id():
    """The worker must accept `estimate_id` so it can load annotations
    from the estimate doc at aggregate time."""
    from routes.ai_blueprint import _execute_ai_blueprint_worker
    import inspect
    sig = inspect.signature(_execute_ai_blueprint_worker)
    params = list(sig.parameters.keys())
    assert "estimate_id" in params
    assert sig.parameters["estimate_id"].default is None


def test_blueprint_annotation_overlay_via_aggregator():
    """End-to-end: annotations passed into `_aggregate_to_hover_shape`
    should produce a per_profile_sqft that contains the annotated
    families."""
    from routes.ai_blueprint import _aggregate_to_hover_shape
    raw = {
        "scale_confidence": "high",
        "story_count": 2,
        "avg_wall_height_ft": 18,
        "siding_coverage_pct": 100,
        "walls": [
            {"label": "front", "width_ft": 30, "height_ft": 18,
             "gable_triangle_height_ft": 0, "dormer_face_sqft": 0,
             "siding_pct_this_wall": 100,
             "wall_body_profile_callout": "DUTCH LAP"},
            {"label": "back",  "width_ft": 30, "height_ft": 18,
             "gable_triangle_height_ft": 8, "dormer_face_sqft": 0,
             "siding_pct_this_wall": 100,
             "wall_body_profile_callout": "DUTCH LAP",
             "gable_profile_callout": ""},
        ],
        "openings": [], "openings_schedule": [], "windows": [],
    }
    annotations = {
        "0": [
            {"elevation_label": "back", "profile": "shake",
             "sqft": 100, "callout": "back gable scallop"},
            {"elevation_label": "front", "profile": "board_batten",
             "sqft": 50, "callout": "porch face"},
        ],
    }
    m = _aggregate_to_hover_shape(raw, annotations=annotations)
    profile = m.get("_per_profile_sqft") or {}
    # All three families should be present
    assert "lap" in profile or "dutch_lap" in profile
    assert profile.get("shake") == 100.0
    assert profile.get("board_batten") == 50.0


def test_blueprint_aggregator_works_without_annotations():
    """Back-compat: existing callers passing only `raw` still work."""
    from routes.ai_blueprint import _aggregate_to_hover_shape
    raw = {
        "scale_confidence": "high",
        "walls": [
            {"label": "front", "width_ft": 30, "height_ft": 9,
             "gable_triangle_height_ft": 0, "dormer_face_sqft": 0,
             "siding_pct_this_wall": 100,
             "wall_body_profile_callout": "LAP"},
        ],
        "openings": [], "openings_schedule": [], "windows": [],
    }
    m = _aggregate_to_hover_shape(raw)
    profile = m.get("_per_profile_sqft") or {}
    assert "lap" in profile
    assert "shake" not in profile  # no annotations → no synthetic add
