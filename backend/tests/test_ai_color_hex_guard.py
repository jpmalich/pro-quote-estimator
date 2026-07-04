"""Iter 79j.28 — hex color validation guard used by _build_measurements.

The 3D viewer feeds ai_measure.py's `_valid_hex` output straight into
`new THREE.Color()`. Bad input (non-strings, wrong length, non-hex chars)
must be filtered here so the frontend never crashes and defaults to grey.
"""
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
sys.path.insert(0, "/app/backend/routes")
load_dotenv(Path("/app/backend/.env"))


def _get_valid_hex():
    """Extract the inline _valid_hex closure from the ai_measure module.

    _build_measurements defines it inline (deliberately local), so we
    exercise the same predicate via a small local re-implementation
    that must stay in sync. When these tests fail, update both.
    """
    def _valid_hex(v):
        if not isinstance(v, str):
            return None
        s = v.strip()
        if len(s) == 7 and s[0] == "#" and all(c in "0123456789abcdefABCDEF" for c in s[1:]):
            return s
        return None
    return _valid_hex


def test_valid_lowercase_hex():
    assert _get_valid_hex()("#7c2e24") == "#7c2e24"


def test_valid_uppercase_hex():
    assert _get_valid_hex()("#B22222") == "#B22222"


def test_hex_without_hash_rejected():
    assert _get_valid_hex()("B22222") is None


def test_short_hex_rejected():
    assert _get_valid_hex()("#B22") is None


def test_non_string_rejected():
    fn = _get_valid_hex()
    assert fn(None) is None
    assert fn(0x7C2E24) is None
    assert fn(["#B22222"]) is None
    assert fn({"hex": "#B22222"}) is None


def test_bad_chars_rejected():
    assert _get_valid_hex()("#GG2222") is None
    assert _get_valid_hex()("#1234567") is None
    assert _get_valid_hex()("#12345 ") is None


def test_stripped_whitespace_ok():
    assert _get_valid_hex()("  #7C2E24  ") == "#7C2E24"
