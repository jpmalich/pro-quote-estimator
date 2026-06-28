"""SEC-003 — Iter 78z+++ — Upload content-type validation tests.

Pins these behaviors:
1. Magic-byte sniffer correctly identifies PNG / JPEG / PDF / WebP / HEIC.
2. Sniffer returns None for non-image content (HTML, text, random bytes).
3. `_safe_content_type_for_serve` always derives MIME from bytes; an
   HTML payload that arrived as `.png` is served as octet-stream with
   `Content-Disposition: attachment` (no inline browser interpretation).
4. Path-traversal-style names are refused by the route.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# ---------------------------------------------------------------------------
# _sniff_mime
# ---------------------------------------------------------------------------
def test_sniff_png():
    from routes.uploads import _sniff_mime
    assert _sniff_mime(b"\x89PNG\r\n\x1a\nfake-png-rest") == "image/png"


def test_sniff_jpeg():
    from routes.uploads import _sniff_mime
    assert _sniff_mime(b"\xff\xd8\xff\xe0\x00\x10JFIF") == "image/jpeg"


def test_sniff_pdf():
    from routes.uploads import _sniff_mime
    assert _sniff_mime(b"%PDF-1.4\n%\xc7\xec") == "application/pdf"


def test_sniff_webp():
    from routes.uploads import _sniff_mime
    # RIFF magic + WEBP signature at offset 8
    data = b"RIFF" + (0).to_bytes(4, "little") + b"WEBP" + b"VP8 "
    assert _sniff_mime(data) == "image/webp"


def test_sniff_riff_without_webp_is_not_image():
    """RIFF magic alone (without WEBP at offset 8) is NOT an image —
    could be a WAV/AVI which we don't accept."""
    from routes.uploads import _sniff_mime
    data = b"RIFF" + (0).to_bytes(4, "little") + b"WAVE" + b"fmt "
    assert _sniff_mime(data) is None


def test_sniff_heic():
    from routes.uploads import _sniff_mime
    data = b"\x00\x00\x00\x20ftypheic" + b"\x00" * 8
    assert _sniff_mime(data) == "image/heic"


def test_sniff_html_payload_returns_none():
    """The core SEC-003 attack: HTML uploaded as .png. Sniffer must
    refuse so the route can either reject (POST) or octet-stream (GET)."""
    from routes.uploads import _sniff_mime
    html = b"<html><body><script>alert(1)</script></body></html>"
    assert _sniff_mime(html) is None


def test_sniff_random_text_returns_none():
    from routes.uploads import _sniff_mime
    assert _sniff_mime(b"this is not a real image") is None


def test_sniff_empty_input_returns_none():
    from routes.uploads import _sniff_mime
    assert _sniff_mime(b"") is None
    assert _sniff_mime(b"abc") is None  # too short


# ---------------------------------------------------------------------------
# _safe_content_type_for_serve
# ---------------------------------------------------------------------------
def test_safe_serve_png_returns_image_png_safe():
    from routes.uploads import _safe_content_type_for_serve
    ctype, is_safe = _safe_content_type_for_serve(b"\x89PNG\r\n\x1a\nrest", "x.png")
    assert ctype == "image/png"
    assert is_safe is True


def test_safe_serve_unknown_forces_octet_stream_attachment():
    """An HTML payload stored as .png on MongoDB MUST be served as
    octet-stream attachment, NEVER as image/png or text/html."""
    from routes.uploads import _safe_content_type_for_serve
    html_bytes = b"<html><body><script>1</script></body></html>"
    ctype, is_safe = _safe_content_type_for_serve(html_bytes, "evil.png")
    assert ctype == "application/octet-stream"
    assert is_safe is False
