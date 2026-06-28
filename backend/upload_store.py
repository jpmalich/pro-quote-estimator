"""Iter 78z+++ — Self-healing upload backing store.

Why this exists: blueprint pages and AI Measure photos live on the
container's local `UPLOAD_DIR`. When the container restarts (deploy,
crash, rolling update) the file system may or may not be persistent
depending on the platform. Howard hit a missing-image case on an old
estimate — files were gone, annotations were useless.

This module persists every upload's bytes into a MongoDB collection
(`upload_blobs`) alongside the disk write. On serve, if the disk file
is missing we transparently fall back to the blob and re-hydrate the
disk cache. Estimates retain their measurement context for the life
of the database, not the container.

Implementation notes:
* MongoDB documents are capped at 16 MB. Our uploads are capped at
  10 MB (`uploads.py`) and 16 MB (`ai_blueprint.py` plan sheets) which
  fits comfortably as a single doc. If we ever need >16 MB we'll move
  to GridFS — keeping this lean for now.
* Stores raw bytes (BSON `Binary`) — Motor handles encoding. No base64
  overhead.
* Idempotent on insert via unique-by-name; an existing name is left
  alone (filenames are uuid4 so collisions are practically zero).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from db import db

logger = logging.getLogger(__name__)

COLLECTION = "upload_blobs"


async def save_blob(name: str, data: bytes, content_type: str = "application/octet-stream") -> bool:
    """Persist an upload's bytes into MongoDB so it survives disk loss.

    Returns True if saved (or already existed), False on error. Failure
    is non-fatal — caller can keep going since the disk file is still
    the primary serving path.
    """
    if db is None:
        return False
    if not name or not data:
        return False
    try:
        existing = await db[COLLECTION].find_one({"name": name}, {"_id": 1})
        if existing:
            return True
        await db[COLLECTION].insert_one({
            "name": name,
            "content_type": content_type or "application/octet-stream",
            "size": len(data),
            "data": data,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return True
    except Exception as e:  # noqa: BLE001 — never surface this to the user
        logger.warning("upload_store.save_blob failed for %s: %s", name, e)
        return False


async def load_blob(name: str) -> Optional[tuple[bytes, str]]:
    """Read an upload's bytes from the MongoDB backing store.

    Returns (data, content_type) on hit, None on miss. Used by the
    /api/uploads/{name} serve handler when the disk copy is gone.
    """
    if db is None or not name:
        return None
    try:
        doc = await db[COLLECTION].find_one({"name": name})
        if not doc or not doc.get("data"):
            return None
        return bytes(doc["data"]), doc.get("content_type") or "application/octet-stream"
    except Exception as e:  # noqa: BLE001
        logger.warning("upload_store.load_blob failed for %s: %s", name, e)
        return None


async def rehydrate_to_disk(name: str, upload_dir: Path) -> Optional[Path]:
    """If we have a blob for `name` but no disk copy, write it back to
    `upload_dir` so subsequent reads (e.g. PIL.Image, fitz, FileResponse)
    work normally. Returns the path on success, None on miss.
    """
    blob = await load_blob(name)
    if blob is None:
        return None
    data, _ctype = blob
    target = upload_dir / name
    try:
        target.write_bytes(data)
        return target
    except Exception as e:  # noqa: BLE001
        logger.warning("upload_store.rehydrate_to_disk failed for %s: %s", name, e)
        return None
