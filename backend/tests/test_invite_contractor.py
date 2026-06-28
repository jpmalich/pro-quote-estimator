"""Backend API tests for the contractor-invitation flow (Iteration 11).

Covers POST /api/admin/invite-contractor and GET /api/admin/invitations:
  - Admin-token gate
  - app_url required
  - Duplicate-email guard (409 when invitee already has an account)
  - Successful invite stores a record + appears in /admin/invitations
  - Invitations list flags registered=True after the invitee signs up
"""

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://app-converter-170.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_TOKEN = os.environ.get("TEST_ADMIN_TOKEN") or os.environ.get("SUPPLIER_ADMIN_TOKEN", "")
ADMIN_HEADERS = {"X-Admin-Token": ADMIN_TOKEN}
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SIGNUP_CODE = os.environ.get("TEST_SIGNUP_CODE") or os.environ.get("SIGNUP_CODE", "")

if not ADMIN_TOKEN:
    pytest.skip(
        "Test secrets missing: export SUPPLIER_ADMIN_TOKEN.",
        allow_module_level=True,
    )


# --------------------------------------------------------------------------- #
# Auth/validation tests (don't require Resend to be configured)
# --------------------------------------------------------------------------- #
class TestInviteAuthAndValidation:
    def test_invite_without_token_is_forbidden(self):
        r = requests.post(
            f"{API}/admin/invite-contractor",
            json={"email": "x@y.com", "app_url": "https://example.com"},
        )
        assert r.status_code == 403

    def test_invite_with_wrong_token_is_forbidden(self):
        r = requests.post(
            f"{API}/admin/invite-contractor",
            json={"email": "x@y.com", "app_url": "https://example.com"},
            headers={"X-Admin-Token": "BAD_TOKEN"},
        )
        assert r.status_code == 403

    def test_invite_missing_app_url_is_bad_request(self):
        r = requests.post(
            f"{API}/admin/invite-contractor",
            json={"email": "x@y.com"},
            headers=ADMIN_HEADERS,
        )
        assert r.status_code == 400
        assert "app_url" in r.json()["detail"]

    def test_invite_invalid_email_is_validation_error(self):
        r = requests.post(
            f"{API}/admin/invite-contractor",
            json={"email": "not-an-email", "app_url": "https://example.com"},
            headers=ADMIN_HEADERS,
        )
        # Pydantic EmailStr validation triggers 422
        assert r.status_code == 422

    def test_invitations_list_requires_admin_token(self):
        r = requests.get(f"{API}/admin/invitations")
        assert r.status_code == 403
        r = requests.get(f"{API}/admin/invitations", headers=ADMIN_HEADERS)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# --------------------------------------------------------------------------- #
# Behaviour tests that need Resend to actually deliver. Skip cleanly if not
# configured so this file still runs on a bare dev box.
# --------------------------------------------------------------------------- #
@pytest.mark.skipif(not RESEND_API_KEY, reason="Resend not configured")
class TestInviteSendBehaviour:
    def test_invite_existing_user_returns_conflict(self):
        # hhunt6677@yahoo.com is the production admin account — guaranteed to exist.
        r = requests.post(
            f"{API}/admin/invite-contractor",
            json={
                "email": "hhunt6677@yahoo.com",
                "app_url": "https://example.com",
            },
            headers=ADMIN_HEADERS,
        )
        assert r.status_code == 409
        assert "already has an account" in r.json()["detail"]

    def test_invite_stores_record_and_lists_it(self):
        # Use Resend's safe sandbox address so we don't blast real users.
        target = f"delivered+{uuid.uuid4().hex[:8]}@resend.dev"
        r = requests.post(
            f"{API}/admin/invite-contractor",
            json={
                "email": target,
                "name": "Test Contractor",
                "personal_note": "Auto-generated test invite — please ignore.",
                "app_url": "https://example.com",
            },
            headers=ADMIN_HEADERS,
        )
        # Resend's "delivered@resend.dev" + tag is allow-listed even on free plans.
        assert r.status_code == 200, f"send failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["status"] == "sent"
        inv = body["invitation"]
        assert inv["email"] == target
        assert inv["name"] == "Test Contractor"
        assert "mode=register" in inv["register_url"]
        assert "code=" in inv["register_url"]

        # Verify it shows up in the recent invitations list.
        listing = requests.get(f"{API}/admin/invitations", headers=ADMIN_HEADERS)
        assert listing.status_code == 200
        emails = [i["email"] for i in listing.json()]
        assert target in emails

        # And it should be flagged as pending (the target hasn't registered).
        row = next(i for i in listing.json() if i["email"] == target)
        assert row["registered"] is False
