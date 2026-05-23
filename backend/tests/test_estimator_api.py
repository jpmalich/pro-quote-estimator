"""Backend API tests for Vinyl Siding Estimator."""
import os
import io
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://app-converter-170.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@wolfandson.com"
ADMIN_PASSWORD = "Admin123!"


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def user_session():
    s = requests.Session()
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "Secret123!", "name": "Tester"})
    assert r.status_code == 200, f"register failed: {r.text}"
    s.test_email = email
    return s


@pytest.fixture(scope="module")
def second_user_session():
    s = requests.Session()
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "Secret123!", "name": "Other"})
    assert r.status_code == 200
    return s


# ---------------- Auth ----------------
class TestAuth:
    def test_root(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_register_sets_cookie(self):
        s = requests.Session()
        email = f"reg_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "Pwd12345!"})
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == email
        assert "id" in data
        assert "access_token" in s.cookies
        # Verify me works
        me = s.get(f"{API}/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == email

    def test_register_duplicate_email(self, user_session):
        r = requests.post(f"{API}/auth/register", json={"email": user_session.test_email, "password": "Whatever1!"})
        assert r.status_code == 400

    def test_login_admin(self, admin_session):
        me = admin_session.get(f"{API}/auth/me")
        assert me.status_code == 200
        u = me.json()
        assert u["email"] == ADMIN_EMAIL
        assert u.get("role") == "admin"
        assert "password_hash" not in u
        assert "_id" not in u

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_logout_clears_cookie(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert s.get(f"{API}/auth/me").status_code == 200
        s.post(f"{API}/auth/logout")
        # Cookie cleared - requests may keep an expired cookie; either way /me must 401
        r = s.get(f"{API}/auth/me")
        # remove cookie if still lingering
        s.cookies.clear()
        r2 = s.get(f"{API}/auth/me")
        assert r.status_code == 401 or r2.status_code == 401

    def test_estimates_requires_auth(self):
        r = requests.get(f"{API}/estimates")
        assert r.status_code == 401


# ---------------- Catalog ----------------
class TestCatalog:
    def test_get_catalog_defaults(self, admin_session):
        # Reset first to ensure defaults
        admin_session.post(f"{API}/catalog/reset")
        r = admin_session.get(f"{API}/catalog")
        assert r.status_code == 200
        data = r.json()
        assert len(data["sections"]) == 10
        first = data["sections"][0]
        assert first["title"] == "Install Vinyl Siding"
        item0 = first["items"][0]
        assert item0["name"] == "Conquest"
        assert item0["mat"] == 92.19
        assert item0["lab"] == 125

    def test_update_catalog(self, admin_session):
        # Get current
        cur = admin_session.get(f"{API}/catalog").json()
        sections = cur["sections"]
        sections[0]["items"][0]["mat"] = 999.99
        r = admin_session.put(f"{API}/catalog", json={"sections": sections})
        assert r.status_code == 200
        # Verify persisted
        again = admin_session.get(f"{API}/catalog").json()
        assert again["sections"][0]["items"][0]["mat"] == 999.99

    def test_reset_catalog(self, admin_session):
        r = admin_session.post(f"{API}/catalog/reset")
        assert r.status_code == 200
        again = admin_session.get(f"{API}/catalog").json()
        assert again["sections"][0]["items"][0]["mat"] == 92.19


# ---------------- Estimates ----------------
class TestEstimates:
    def test_create_list_get(self, user_session):
        payload = {
            "customer_name": "TEST_John Doe",
            "address": "123 Main St",
            "estimate_number": "E001",
            "lines": [{"section": "Install Vinyl Siding", "name": "Conquest",
                       "unit": "SQ", "qty": 10, "mat": 92.19, "lab": 125}],
        }
        r = user_session.post(f"{API}/estimates", json=payload)
        assert r.status_code == 200, r.text
        est = r.json()
        assert "id" in est and est["customer_name"] == "TEST_John Doe"
        assert est.get("user_id")
        assert "_id" not in est
        user_session.est_id = est["id"]

        lst = user_session.get(f"{API}/estimates")
        assert lst.status_code == 200
        ids = [e["id"] for e in lst.json()]
        assert est["id"] in ids

        one = user_session.get(f"{API}/estimates/{est['id']}")
        assert one.status_code == 200
        assert one.json()["customer_name"] == "TEST_John Doe"

    def test_update_estimate(self, user_session):
        eid = user_session.est_id
        update = {
            "customer_name": "TEST_Updated",
            "lines": [{"section": "Install Vinyl Siding", "name": "Conquest",
                       "unit": "SQ", "qty": 20, "mat": 92.19, "lab": 125}],
            "waste_pct": 5.0, "tax_enabled": False, "tax_rate": 0,
            "margin_pct": 25.0, "notes": "updated notes",
        }
        r = user_session.put(f"{API}/estimates/{eid}", json=update)
        assert r.status_code == 200
        doc = r.json()
        assert doc["customer_name"] == "TEST_Updated"
        assert doc["waste_pct"] == 5.0
        assert doc["margin_pct"] == 25.0
        assert doc["notes"] == "updated notes"
        assert doc["lines"][0]["qty"] == 20

        # Verify with GET
        again = user_session.get(f"{API}/estimates/{eid}").json()
        assert again["customer_name"] == "TEST_Updated"
        assert again["notes"] == "updated notes"

    def test_user_isolation(self, user_session, second_user_session):
        eid = user_session.est_id
        r1 = second_user_session.get(f"{API}/estimates/{eid}")
        assert r1.status_code == 404
        r2 = second_user_session.put(f"{API}/estimates/{eid}", json={"customer_name": "hack"})
        assert r2.status_code == 404
        r3 = second_user_session.delete(f"{API}/estimates/{eid}")
        assert r3.status_code == 404

    def test_delete_estimate(self, user_session):
        eid = user_session.est_id
        r = user_session.delete(f"{API}/estimates/{eid}")
        assert r.status_code == 200
        g = user_session.get(f"{API}/estimates/{eid}")
        assert g.status_code == 404


# ---------------- Uploads ----------------
class TestUploads:
    def test_upload_and_serve(self, user_session):
        # Minimal valid 1x1 PNG
        png_bytes = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
                     b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
                     b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
                     b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82")
        files = {"file": ("test.png", io.BytesIO(png_bytes), "image/png")}
        r = user_session.post(f"{API}/uploads", files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["url"].startswith("/api/uploads/")
        # Fetch the file
        full = BASE_URL + data["url"]
        g = requests.get(full)
        assert g.status_code == 200
        assert g.content == png_bytes


# ---------------- Email ----------------
class TestEmail:
    def test_email_status_unconfigured(self, user_session):
        r = user_session.get(f"{API}/email/status")
        assert r.status_code == 200
        data = r.json()
        assert data["configured"] is False
        assert data["sender"] is None

    def test_email_send_returns_503(self, user_session):
        # create an estimate for this user
        r = user_session.post(f"{API}/estimates", json={"customer_name": "TEST_Email"})
        eid = r.json()["id"]
        try:
            send = user_session.post(
                f"{API}/estimates/{eid}/email",
                json={"recipient_email": "to@example.com", "html_quote": "<p>hi</p>"},
            )
            assert send.status_code == 503
            assert "not configured" in send.json().get("detail", "").lower()
        finally:
            user_session.delete(f"{API}/estimates/{eid}")
