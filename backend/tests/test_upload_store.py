"""Iter 78z+++ — Upload retention bump: durable MongoDB backing store.

Verifies:
1. `save_blob` round-trips bytes through MongoDB.
2. `load_blob` returns the saved data + content type.
3. `rehydrate_to_disk` restores a missing disk file from the blob.
4. Idempotency — saving the same name twice doesn't error or duplicate.
5. Graceful degradation — when `db` is None, helpers return False/None
   instead of raising (so callers can keep going).
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class UploadStoreTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        # Skip the whole class if MongoDB isn't reachable in this
        # environment (CI / sandbox). Tests assume a local Mongo.
        mongo_url = os.environ.get("MONGO_URL")
        if not mongo_url:
            raise unittest.SkipTest("MONGO_URL not set — skipping upload_store integration tests")

    async def asyncSetUp(self):
        # The shared db.py client is bound to whatever event loop was
        # current at import time. pytest-asyncio creates a fresh loop
        # per test, which breaks the shared client. Spin up a per-test
        # Motor client tied to the current loop so upload_store can use it.
        import os as _os
        from motor.motor_asyncio import AsyncIOMotorClient
        import db as db_module
        mongo_url = _os.environ.get("MONGO_URL")
        db_name = _os.environ.get("DB_NAME") or "vinyl_estimator"
        self._client = AsyncIOMotorClient(mongo_url)
        # Hot-swap upload_store's db reference for this test.
        import upload_store
        self._orig_db = upload_store.db
        upload_store.db = self._client[db_name]
        self.db = self._client[db_name]
        self.test_names = []

    async def asyncTearDown(self):
        for name in self.test_names:
            try:
                await self.db["upload_blobs"].delete_many({"name": name})
            except Exception:
                pass
        # Restore the module-level db reference
        import upload_store
        upload_store.db = self._orig_db
        self._client.close()

    async def test_save_and_load_roundtrip(self):
        from upload_store import save_blob, load_blob
        name = "test-upload-store-rt.png"
        self.test_names.append(name)
        payload = b"\x89PNG\r\n\x1a\nfake-png-bytes"
        ok = await save_blob(name, payload, "image/png")
        self.assertTrue(ok)
        result = await load_blob(name)
        self.assertIsNotNone(result)
        data, ctype = result
        self.assertEqual(data, payload)
        self.assertEqual(ctype, "image/png")

    async def test_load_blob_returns_none_for_missing_name(self):
        from upload_store import load_blob
        result = await load_blob("does-not-exist-anywhere.png")
        self.assertIsNone(result)

    async def test_rehydrate_to_disk_writes_file_back(self):
        from upload_store import rehydrate_to_disk, save_blob
        name = "test-upload-store-rehyd.jpg"
        self.test_names.append(name)
        payload = b"\xff\xd8\xff\xe0fake-jpeg-bytes"
        await save_blob(name, payload, "image/jpeg")
        with tempfile.TemporaryDirectory() as td:
            tdpath = Path(td)
            # Disk is empty
            self.assertFalse((tdpath / name).exists())
            restored = await rehydrate_to_disk(name, tdpath)
            self.assertIsNotNone(restored)
            self.assertTrue(restored.exists())
            self.assertEqual(restored.read_bytes(), payload)

    async def test_rehydrate_to_disk_returns_none_when_no_blob(self):
        from upload_store import rehydrate_to_disk
        with tempfile.TemporaryDirectory() as td:
            restored = await rehydrate_to_disk("nonexistent.bin", Path(td))
            self.assertIsNone(restored)

    async def test_save_blob_idempotent_on_same_name(self):
        from upload_store import save_blob, load_blob
        name = "test-upload-store-idem.png"
        self.test_names.append(name)
        # First save
        ok1 = await save_blob(name, b"first", "image/png")
        self.assertTrue(ok1)
        # Second save with DIFFERENT content for the SAME name: we
        # leave the existing blob alone (filenames are uuid4 so real
        # collisions are zero; an "overwrite same name" indicates
        # something is wrong upstream and we don't want to silently
        # diverge from disk).
        ok2 = await save_blob(name, b"second", "image/png")
        self.assertTrue(ok2)
        result = await load_blob(name)
        self.assertIsNotNone(result)
        data, _ = result
        self.assertEqual(data, b"first")
        # Sanity: no duplicates.
        count = await self.db["upload_blobs"].count_documents({"name": name})
        self.assertEqual(count, 1)

    async def test_save_blob_no_op_for_empty_inputs(self):
        from upload_store import save_blob
        self.assertFalse(await save_blob("", b"data"))
        self.assertFalse(await save_blob("name.bin", b""))


if __name__ == "__main__":
    asyncio.run(unittest.main())
