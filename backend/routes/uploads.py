"""Photo / file uploads (per-contractor).

Iter 78z+++ — Every upload is also mirrored into a MongoDB backing
store (`upload_blobs`) so estimates keep their measurement context
even if the container's local disk gets wiped on restart/redeploy.
GET /uploads/{name} self-heals: disk first, MongoDB fallback,
re-hydrate disk on miss.
"""
import mimetypes
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from config import UPLOAD_DIR
from deps import get_current_user
from upload_store import load_blob, rehydrate_to_disk, save_blob

router = APIRouter()


@router.post("/uploads")
async def upload_photo(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = (file.filename or "").split(".")[-1].lower() or "jpg"
    if ext not in {"jpg", "jpeg", "png", "webp", "heic"}:
        ext = "jpg"
    name = f"{uuid.uuid4().hex}.{ext}"
    dest = UPLOAD_DIR / name
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (>10MB)")
    with open(dest, "wb") as f:
        f.write(content)
    # Mirror into the durable MongoDB backing store. Failure here is
    # non-fatal — disk write still succeeded and is the primary serve
    # path; the blob is insurance against future disk loss.
    ctype = (file.content_type or mimetypes.guess_type(name)[0]
             or "application/octet-stream")
    await save_blob(name, content, ctype)
    return {"url": f"/api/uploads/{name}", "name": name}


@router.get("/uploads/{name}")
async def serve_upload(name: str):
    target = UPLOAD_DIR / name
    if target.exists():
        return FileResponse(str(target))
    # Disk miss → check MongoDB. If we have a blob, rehydrate the disk
    # cache so subsequent helpers (PIL, fitz, range requests) work.
    restored = await rehydrate_to_disk(name, UPLOAD_DIR)
    if restored and restored.exists():
        return FileResponse(str(restored))
    # Final fallback: serve directly from MongoDB without touching disk
    # (covers the case where disk is read-only or full).
    blob = await load_blob(name)
    if blob:
        data, ctype = blob
        return Response(content=data, media_type=ctype)
    raise HTTPException(status_code=404, detail="Not found")
