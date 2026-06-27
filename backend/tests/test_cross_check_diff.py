"""Iter 78z (Cross-Check) — Reference photo cross-check diff helper.

The Claude vision call is mocked at the integration level (expensive
to run in CI). These tests pin the diff math: how the verifier's output
turns into conflicts + suggested_accents vs the primary breakdown.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from routes.ai_measure import _compute_recheck_diff, _normalize_family


def test_normalize_canonical_families():
    assert _normalize_family("lap") == "lap"
    assert _normalize_family("shake") == "shake"
    assert _normalize_family("board_batten") == "board_batten"


def test_normalize_common_synonyms():
    assert _normalize_family("Clapboard") == "lap"
    assert _normalize_family("DutchLap") == "dutch_lap"
    assert _normalize_family("shaker") == "shake"
    assert _normalize_family("shingle") == "shake"
    assert _normalize_family("BNB") == "board_batten"
    assert _normalize_family("batten") == "board_batten"


def test_normalize_empty_and_unknown():
    assert _normalize_family("") == ""
    assert _normalize_family(None) == ""
    assert _normalize_family("unknown") == "unknown"
    assert _normalize_family("future_xyz") == ""


def test_diff_no_conflicts_when_primary_matches_verified():
    primary = [
        {"label": "front", "wall_body_profile": "lap", "gable_profile": "",
         "dormer_profile": "", "accents": []},
        {"label": "back", "wall_body_profile": "lap", "gable_profile": "shake",
         "dormer_profile": "", "accents": []},
    ]
    verified = {
        "overall_confidence": "high",
        "per_elevation": [
            {"label": "front", "body_profile": "lap", "gable_profile": "", "dormer_profile": "", "accents": []},
            {"label": "back", "body_profile": "lap", "gable_profile": "shake", "dormer_profile": "", "accents": []},
        ],
    }
    r = _compute_recheck_diff(primary, verified)
    assert r["conflicts"] == []
    assert r["suggested_accents"] == []
    assert r["agreement_pct"] == 100.0


def test_diff_flags_profile_conflict():
    """Primary said LAP, verifier says SHAKE on front body."""
    primary = [
        {"label": "front", "wall_body_profile": "lap", "gable_profile": "",
         "dormer_profile": "", "accents": []},
    ]
    verified = {
        "overall_confidence": "medium",
        "per_elevation": [
            {"label": "front", "body_profile": "shake", "gable_profile": "", "dormer_profile": "", "accents": []},
        ],
    }
    r = _compute_recheck_diff(primary, verified)
    assert len(r["conflicts"]) == 1
    c = r["conflicts"][0]
    assert c["elev"] == "front"
    assert c["role"] == "body"
    assert c["primary"] == "lap"
    assert c["verified"] == "shake"
    assert r["agreement_pct"] == 0.0


def test_diff_suggests_new_accent_when_verifier_adds_one():
    """Verifier found a porch B&B that primary missed → suggested_accent."""
    primary = [
        {"label": "front", "wall_body_profile": "lap", "gable_profile": "",
         "dormer_profile": "", "accents": []},
    ]
    verified = {
        "overall_confidence": "high",
        "per_elevation": [
            {
                "label": "front",
                "body_profile": "lap",
                "gable_profile": "",
                "dormer_profile": "",
                "accents": [
                    {"location": "porch face", "profile": "board_batten",
                     "approx_sqft": 48, "confidence": "high",
                     "callout": "vertical battens visible behind columns"},
                ],
            },
        ],
    }
    r = _compute_recheck_diff(primary, verified)
    assert r["conflicts"] == []  # body still matches
    assert len(r["suggested_accents"]) == 1
    sa = r["suggested_accents"][0]
    assert sa["elev"] == "front"
    assert sa["location"] == "porch face"
    assert sa["profile"] == "board_batten"
    assert sa["approx_sqft"] == 48.0


def test_diff_does_not_re_suggest_existing_accent():
    """Primary already has the accent — verifier confirms it. No suggestion."""
    primary = [
        {"label": "front", "wall_body_profile": "lap",
         "gable_profile": "", "dormer_profile": "",
         "accents": [{"location": "porch face", "profile": "board_batten", "sqft": 48}]},
    ]
    verified = {
        "per_elevation": [
            {
                "label": "front",
                "body_profile": "lap",
                "accents": [
                    {"location": "porch face", "profile": "board_batten",
                     "approx_sqft": 48, "confidence": "high"},
                ],
            },
        ],
    }
    r = _compute_recheck_diff(primary, verified)
    assert r["suggested_accents"] == []


def test_diff_handles_empty_primary():
    """Empty primary breakdown — verifier's whole output becomes
    suggestions / body-conflict."""
    primary = []
    verified = {
        "per_elevation": [
            {"label": "front", "body_profile": "lap"},
        ],
    }
    r = _compute_recheck_diff(primary, verified)
    # No primary to disagree with, so no conflicts and no agreement pct
    assert r["agreement_pct"] == 100.0  # 0/0 → 100% by convention
    # But the body conflict (primary has none) fires:
    assert len(r["conflicts"]) == 1
    assert r["conflicts"][0]["primary"] == ""
    assert r["conflicts"][0]["verified"] == "lap"


def test_diff_zero_or_negative_sqft_accent_skipped():
    primary = [{"label": "front", "wall_body_profile": "lap", "accents": []}]
    verified = {
        "per_elevation": [
            {
                "label": "front",
                "body_profile": "lap",
                "accents": [
                    {"location": "porch", "profile": "shake", "approx_sqft": 0},
                    {"location": "negative", "profile": "shake", "approx_sqft": -5},
                ],
            },
        ],
    }
    r = _compute_recheck_diff(primary, verified)
    assert r["suggested_accents"] == []


def test_diff_gable_conflict_detected():
    """Primary said no gable profile, verifier says shake gable."""
    primary = [
        {"label": "right", "wall_body_profile": "lap", "gable_profile": "lap",
         "dormer_profile": "", "accents": []},
    ]
    verified = {
        "per_elevation": [
            {"label": "right", "body_profile": "lap", "gable_profile": "shake",
             "dormer_profile": "", "accents": []},
        ],
    }
    r = _compute_recheck_diff(primary, verified)
    conflicts = [c for c in r["conflicts"] if c["role"] == "gable"]
    assert len(conflicts) == 1
    assert conflicts[0]["verified"] == "shake"


def test_diff_case_insensitive_label_match():
    primary = [{"label": "Front", "wall_body_profile": "lap", "accents": []}]
    verified = {
        "per_elevation": [
            {"label": "FRONT", "body_profile": "shake"},
        ],
    }
    r = _compute_recheck_diff(primary, verified)
    assert len(r["conflicts"]) == 1
    assert r["conflicts"][0]["elev"] == "front"
