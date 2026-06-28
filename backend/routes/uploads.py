"""Photo / file uploads (per-contractor).

Iter 78z+++ — Every upload is also mirrored into a MongoDB backing
store (`upload_blobs`) so estimates keep their measurement context
even if the container's local disk gets wiped on restart/redeploy.
GET /uploads/{name} self-heals: disk first, MongoDB fallback,
re-hydrate disk on miss.

SEC-003 — Iter 78z+++ hardening:
  * **Magic-byte validation on POST**: bytes must actually start with
    PNG / JPEG / PDF / WebP / HEIC headers — the `.png` extension on
    a malicious payload (e.g. an HTML file) is no longer trusted.
  * **Forced safe content-type on GET**: the response's `Content-Type`
    is derived from the magic bytes at serve time, never from the
    user-supplied `content_type` field. Prevents the "upload HTML,
    get it served as text/html from app origin" XSS sink the audit
    flagged.
  * Files that fail the magic-byte check on POST are rejected (415).
  * Files in MongoDB that fail the magic-byte check on GET return as
    `application/octet-stream` with `Content-Disposition: attachment`
    so the browser downloads rather than interprets.
"""
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from config import UPLOAD_DIR
from deps import get_current_user
from upload_store import load_blob, rehydrate_to_disk, save_blob

router = APIRouter()


# SEC-003 — Magic-byte signatures we accept. (ext, magic-bytes-prefix,
# canonical mime). HEIC has many flavours; we check the major ones via
# the ftyp box family.
_MAGIC_SIGNATURES: list[tuple[str, bytes, str]] = [
    ("png",  b"\x89PNG\r\n\x1a\n",        "image/png"),
    ("jpg",  b"\xff\xd8\xff",              "image/jpeg"),
    ("jpeg", b"\xff\xd8\xff",              "image/jpeg"),
    ("pdf",  b"%PDF-",                     "application/pdf"),
    ("webp", b"RIFF",                      "image/webp"),  # also has WEBP at byte 8
]


def _sniff_mime(content: bytes) -> str | None:
    """Return the canonical MIME type if the bytes match a known
    magic signature, else None. WebP is checked as RIFF + 'WEBP' at
    offset 8. HEIC/HEIF detected via 'ftyp' box at offset 4."""
    if not content or len(content) < 4:
        return None
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    if content.startswith(b"RIFF") and len(content) > 12 and content[8:12] == b"WEBP":
        return "image/webp"
    # HEIC / HEIF: 'ftyp' box at offset 4, with brand 'heic'/'heix'/
    # 'hevc'/'hevx'/'heim'/'heis'/'hevm'/'hevs'/'mif1'
    if (
        len(content) > 12
        and content[4:8] == b"ftyp"
        and content[8:12]
        in {
            b"heic", b"heix", b"hevc", b"hevx",
            b"heim", b"heis", b"hevm", b"hevs",
            b"mif1",
        }
    ):
        return "image/heic"
    return None


def _safe_content_type_for_serve(content: bytes, fallback_name: str) -> tuple[str, bool]:
    """Decide the response Content-Type for a served upload. The
    sniffed MIME wins (so a renamed .png that's actually HTML gets
    served as octet-stream). Returns (content_type, is_safe).
    `is_safe=False` means the renderer should also set
    `Content-Disposition: attachment` so the browser doesn't try to
    interpret the file inline.
    """
    sniffed = _sniff_mime(content[:16])
    if sniffed:
        return sniffed, True
    # Unknown / unsigned content — force download to neutralise any
    # interpretation as HTML/JS/SVG.
    return "application/octet-stream", False


@router.post("/uploads")
async def upload_photo(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = (file.filename or "").split(".")[-1].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "webp", "heic"}:
        ext = "jpg"
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (>10MB)")
    # SEC-003 — Validate magic bytes. Filename extension is contractor-
    # controlled and not trustworthy; the bytes must actually be an
    # image we recognise.
    sniffed = _sniff_mime(content[:16])
    if sniffed is None or sniffed not in {
        "image/png", "image/jpeg", "image/webp", "image/heic",
    }:
        raise HTTPException(
            status_code=415,
            detail="Unsupported file type — upload must be PNG / JPEG / WebP / HEIC",
        )
    # Align extension with what the bytes actually are.
    ext_from_mime = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/heic": "heic",
    }[sniffed]
    name = f"{uuid.uuid4().hex}.{ext_from_mime}"
    dest = UPLOAD_DIR / name
    with open(dest, "wb") as f:
        f.write(content)
    # Mirror into the durable MongoDB backing store. Failure is
    # non-fatal — disk write still succeeded.
    await save_blob(name, content, sniffed)
    return {"url": f"/api/uploads/{name}", "name": name}


@router.get("/uploads/{name}")
async def serve_upload(name: str):
    # SEC-003 — Refuse path traversal up-front.
    if "/" in name or ".." in name or name.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid upload name")
    target = UPLOAD_DIR / name
    # Resolve and make sure the resolved path is still inside
    # UPLOAD_DIR — belt-and-suspenders against any encoding bypass.
    try:
        if target.exists() and not str(target.resolve()).startswith(str(Path(UPLOAD_DIR).resolve())):
            raise HTTPException(status_code=400, detail="Invalid upload name")
    except (OSError, RuntimeError):
        raise HTTPException(status_code=400, detail="Invalid upload name")

    data: bytes | None = None
    if target.exists():
        try:
            data = target.read_bytes()
        except OSError:
            data = None
    if data is None:
        # Disk miss → rehydrate from MongoDB.
        restored = await rehydrate_to_disk(name, UPLOAD_DIR)
        if restored and restored.exists():
            try:
                data = restored.read_bytes()
            except OSError:
                data = None
    if data is None:
        # Final fallback: load blob directly.
        blob = await load_blob(name)
        if blob:
            data, _stored_ctype = blob
    if data is None:
        raise HTTPException(status_code=404, detail="Not found")

    # SEC-003 — Always derive the Content-Type from the bytes, never
    # from the user-supplied content_type at upload time. Unknown
    # types are forced to attachment download.
    ctype, is_safe = _safe_content_type_for_serve(data, name)
    headers: dict[str, str] = {}
    if not is_safe:
        headers["Content-Disposition"] = f'attachment; filename="{name}"'
    # X-Content-Type-Options blocks browser MIME-sniffing for all
    # uploads regardless — defence in depth.
    headers["X-Content-Type-Options"] = "nosniff"
    return Response(content=data, media_type=ctype, headers=headers)


# Re-export so other modules can call the sniffer if needed (e.g.,
# `_persist_page_image` in ai_blueprint already trusts the bytes it
# rendered, so no change there).
__all__ = ["router", "_sniff_mime", "_safe_content_type_for_serve"]
# Quiet unused-import warning for mimetypes (kept available for future use)
_ = mimetypes
