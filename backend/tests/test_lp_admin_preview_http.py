"""HTTP integration tests for the LP Formula Preview admin endpoint (Iter 78ab)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app.pro-quotes.com").rstrip("/")
ADMIN_TOKEN = "OXSp1EXqp1rPLsQfeEoZyDbFCLZ3D6B2D55HyO1LFoE"
HDR = {"X-Admin-Token": ADMIN_TOKEN, "Content-Type": "application/json"}


# ─── GET /api/admin/lp-formula-preview/presets ─────────────────────────────
class TestPresetsCatalog:
    def test_presets_returns_4_known_keys(self):
        r = requests.get(f"{BASE_URL}/api/admin/lp-formula-preview/presets", headers=HDR, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "presets" in data
        keys = {p["key"] for p in data["presets"]}
        assert keys == {"campbell", "shake_heavy", "bb_heavy", "lap_only"}
        # Labels are non-empty
        for p in data["presets"]:
            assert isinstance(p["label"], str) and len(p["label"]) > 5

    def test_presets_403_when_token_missing(self):
        r = requests.get(f"{BASE_URL}/api/admin/lp-formula-preview/presets", timeout=20)
        assert r.status_code == 403

    def test_presets_403_when_token_wrong(self):
        r = requests.get(
            f"{BASE_URL}/api/admin/lp-formula-preview/presets",
            headers={"X-Admin-Token": "WRONG"},
            timeout=20,
        )
        assert r.status_code == 403


# ─── POST /api/admin/lp-formula-preview ─────────────────────────────
class TestPreviewDiff:
    def _post(self, body):
        return requests.post(f"{BASE_URL}/api/admin/lp-formula-preview", headers=HDR, json=body, timeout=30)

    def test_campbell_response_shape(self):
        r = self._post({"preset": "campbell"})
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("preset_used", "preset_label", "measurements", "diff", "summary", "flag_currently_enabled"):
            assert k in d, f"missing field: {k}"
        assert d["preset_used"] == "campbell"
        assert isinstance(d["diff"], list) and len(d["diff"]) > 0
        assert "lines_total" in d["summary"] and "lines_changed" in d["summary"]
        assert d["summary"]["lines_total"] == len(d["diff"])

    def test_campbell_lap_pdf_qty_greater(self):
        d = self._post({"preset": "campbell"}).json()
        lap_rows = [r for r in d["diff"] if '38 Series Lap 3/8" x 8" x 16' in r["name"]]
        assert lap_rows, f"no lap row found. names: {[r['name'] for r in d['diff']]}"
        row = lap_rows[0]
        assert row["legacy_qty"] < row["pdf_qty"], row

    def test_campbell_shake_pdf_3x_legacy(self):
        d = self._post({"preset": "campbell"}).json()
        shake_rows = [r for r in d["diff"] if r["name"] == "Shake" or "Shake" in r["name"]]
        # Pick the field shake (not 540 trim)
        shake_field = [r for r in shake_rows if "540" not in r["name"] and "Trim" not in r["name"]]
        assert shake_field, f"no shake row found in {[r['name'] for r in d['diff']]}"
        row = shake_field[0]
        # Legacy 9.09 sqft/PCS heavily under-counts; PDF should be ~3-4x bigger
        assert row["pdf_qty"] >= row["legacy_qty"] * 2.5, row

    def test_bb_heavy_emits_190_series_batten(self):
        d = self._post({"preset": "bb_heavy"}).json()
        batten = [r for r in d["diff"] if "190 Series Trim" in r["name"]]
        assert batten, f"no 190 Series batten in {[r['name'] for r in d['diff']]}"
        row = batten[0]
        assert row["legacy_qty"] == 0
        assert row["pdf_qty"] > 0

    def test_invalid_preset_400(self):
        r = self._post({"preset": "does_not_exist"})
        assert r.status_code == 400, r.text

    def test_empty_body_400(self):
        r = self._post({})
        assert r.status_code == 400, r.text

    def test_flag_default_off(self):
        d = self._post({"preset": "campbell"}).json()
        assert d["flag_currently_enabled"] is False

    def test_403_without_token(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/lp-formula-preview",
            json={"preset": "campbell"},
            timeout=30,
        )
        assert r.status_code == 403

    def test_shake_heavy_differs_from_campbell(self):
        camp = self._post({"preset": "campbell"}).json()
        sh = self._post({"preset": "shake_heavy"}).json()
        # The diff arrays should differ in shape or numbers
        assert (camp["diff"] != sh["diff"]) or (camp["summary"] != sh["summary"])
