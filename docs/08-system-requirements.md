# 8. System Requirements

*Part of the [Pro-Quote documentation](README.md).*

## Server / development

| Component | Requirement |
|---|---|
| Python | 3.11 (ruff `target-version = "py311"`) |
| Node.js + Yarn | Yarn 1.22.x (pinned via `packageManager`); CRA 5 / react-scripts |
| MongoDB | Any Motor/pymongo-4-compatible instance; TTL index support |
| WeasyPrint system deps | Pango/Cairo/GDK-PixBuf native libraries (for PDF rendering) |
| Outbound network | api.anthropic.com, api.resend.com, maps.googleapis.com |

## Environment variables (backend `.env`)

The server *fails closed at import* without the critical ones:

| Variable | Required | Purpose |
|---|---|---|
| `MONGO_URL`, `DB_NAME` | ✅ | Database connection |
| `JWT_SECRET` | ✅ (≥ 32 chars) | Session signing |
| `ADMIN_PASSWORD`, `ADMIN_EMAIL` | ✅ | Seeded supplier-admin account |
| `CORS_ORIGINS` | ✅ (else all cross-origin refused) | Explicit origin allowlist |
| `SUPPLIER_ADMIN_TOKEN` | for admin panel | `X-Admin-Token` value |
| `SIGNUP_CODE` | recommended | Contractor access code (stable fallback derived from JWT_SECRET) |
| `ANTHROPIC_API_KEY` | for AI features | Direct Anthropic Claude access |
| `RESEND_API_KEY`, `SENDER_EMAIL`, `RESEND_WEBHOOK_SECRET` | for email | Quote sending + tracking |
| `GOOGLE_MAPS_API_KEY` | for satellite measure | Geocode + imagery |
| `JWT_TTL_SECONDS` | optional (default 7 days) | Session length |
| `LP_AI_FORMULAS_V1` | optional flag | New LP quantity formulas |

**Frontend env**: `REACT_APP_BACKEND_URL` (the only one) — base URL of the backend.

## Client

- Any modern evergreen browser; mobile-first design targeted at **phones and tablets** in the field.
- Installable as a PWA (Add to Home Screen on iOS/Android); static shell works cache-first offline,
  but all data operations require connectivity.

## Running with Docker (recommended)

The repo ships a self-contained stack — MongoDB + backend + frontend:

```bash
cp backend/.env.example backend/.env     # fill in JWT_SECRET, ADMIN_PASSWORD, keys…
docker compose up --build                # frontend on :3000, API on :8000
```

## Running locally (without Docker)

```bash
# Backend
cd backend
pip install -r requirements.txt          # needs WeasyPrint native libs present
cp .env.example .env                     # then fill in the required variables
uvicorn server:app --reload              # http://localhost:8000

# Frontend
cd frontend
yarn install
echo "REACT_APP_BACKEND_URL=http://localhost:8000" > .env
yarn start                               # http://localhost:3000
```

## Tests and linting

```bash
cd backend && ruff check . && pytest tests/    # HTTP integration tests — need a running
                                               # deployment + SIGNUP_CODE/TEST_* env vars,
                                               # otherwise they skip cleanly
cd frontend && npx eslint src
node frontend/src/lib/wasteLogic.test.mjs      # pure-logic regression test
```
