# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Pro-Quote Estimating Tool" — a supplier-distributed B2B SaaS siding/window estimator. Alside Supply (the supplier) owns the platform and distributes it to contractor customers, who build branded estimates for homeowners. Full product context lives in `memory/PRD.md`; deferred work and follow-ups live in `memory/REMINDERS.md`, and the consolidated working TODO list is `TODOS.md` (read these at session start; check items off / add new ones as work lands). The project was originally scaffolded on the Emergent platform but has been decoupled: AI calls go through `backend/llm.py` (official `anthropic` SDK, `ANTHROPIC_API_KEY`) and the stack self-hosts via `docker-compose.yml`.

## Commands

### Backend (FastAPI + MongoDB, Python 3.11)
```bash
cd backend
ruff check .                          # lint (config in pyproject.toml)
pytest tests/                         # all tests
pytest tests/test_vero_pricing.py     # one file
pytest tests/test_estimator_api.py -k invite   # one test by keyword
uvicorn server:app --reload           # run the API
```
- The server **fails closed at import** without env vars: `JWT_SECRET` (≥32 chars), `ADMIN_PASSWORD`, `MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`. There is no `.env` checked in — one must exist at `backend/.env`.
- Backend tests are **integration tests over HTTP** (`requests` against `REACT_APP_BACKEND_URL`, defaulting to the deployed preview URL). They skip cleanly when `SIGNUP_CODE`/`TEST_*` env vars are absent — that skip is intentional, not a failure.

### Frontend (React 19, CRA + craco, Yarn)
```bash
cd frontend
yarn start            # dev server on :3000
yarn build            # production build
npx eslint src        # lint (ESLint v9 flat config in eslint.config.js)
node src/lib/wasteLogic.test.mjs   # pure-logic regression test (plain ESM, no runner)
```
- Uses **Yarn** (`yarn.lock`, `packageManager` pin) — not npm.
- `@` aliases to `frontend/src` (craco.config.js / jsconfig.json).
- Frontend needs `REACT_APP_BACKEND_URL` in `frontend/.env` (all API calls go to `${REACT_APP_BACKEND_URL}/api`).

## Code-quality philosophy (read before flagging anything)

`CODE_QUALITY.md` and the long comment in `backend/pyproject.toml` pin what this project considers a real finding. Ruff selects only `E, W, F`; complexity, type-hint, docstring, and pyupgrade rules are **deliberately excluded**. Do not flag: long straight-line functions, missing type hints, `Optional[X]` instead of `X | None`, hardcoded creds in `tests/` (fixtures), or inline Provider values. If a lint tool surfaces something these configs don't, treat it as noise — don't refactor working code.

## Architecture

### Backend (`backend/`)
- `server.py` is a thin entrypoint: loads `.env` **before** other imports (that's why `E402` is ignored), wires CORS (wildcard origins stripped — fail closed), and mounts `routes.api_router` under `/api`.
- `routes/` holds one module per feature (auth, estimates, catalog, company, branding, hover, mezzo, vero, iss, ai_measure, ai_blueprint, pricing admin panels, …), composed in `routes/__init__.py`.
- `config.py` is the single env-driven config module; `db.py` exposes the shared Motor client/`db`; `services.py` and `startup.py` hold business logic and boot-time seeding.
- **Multi-tenant by Company**: JWT cookie auth (httpOnly). Contractors register with a rotatable `SIGNUP_CODE` or join an existing company via 8-char invite code. Each company gets its own catalog/branding/estimates.
- **Supplier admin surface** is separate: `/api/admin/*` gated by the `X-Admin-Token` **header only** — never put the token in a query string (SEC-006; tokens in URLs leak via logs/history). Frontend admin lives at `/branding-admin`.
- **Product lines each have their own catalog + pricing modules and seed data**: vinyl/ascend (`catalog_seed.py`), LP SmartSide (`lp_smartside_formulas.py`), Vero windows (`vero_catalog.py`/`vero_prices.py` + JSON seed), Mezzo windows (`mezzo_*`), ISS (`iss_catalog.py`).
- **HOVER import** (`routes/hover.py`): parses HOVER measurement PDFs and auto-populates estimate lines via `HOVER_MAPPING_SPEC` (declarative measurement→catalog-line mappings). Windows imports emit *paired* `vero_openings` and `mezzo_openings` with matching UUIDs and dimensions.

### Frontend (`frontend/src/`)
- `pages/` — routed screens (Dashboard, EstimateEditor, Catalog, BrandingAdmin, ISSEstimateEditor, …). `components/` — shared UI plus shadcn/Radix primitives in `components/ui/`.
- `lib/` is where the real logic lives, not just utilities:
  - `useEstimate.js` — the estimate state hook (load/merge with catalog/autosave). **Gotcha:** its `TAB_IDS` list gates which tab values survive load; a tab id missing from it silently rebadges saved lines and can wipe them on the next autosave.
  - `tabsConfig.js` — single source of truth for product-line tabs. Tab ids are `vinyl`, `ascend`, `lp_smart`, `windows` (= Vero — the id is literally `"windows"`, not `"vero"`), `mezzo`. Siding-kind and windows-kind estimates use disjoint tab sets and can be *paired* (one job, two estimates).
  - `calc.js` — totals are computed from **persisted per-opening snapshots**, not live catalog lookups; `useReconcileWindowSnapshots.js` refreshes stale snapshots once per estimate load. Mezzo price buckets use `min_ui`/`max_ui` keys while Vero uses `min`/`max` — don't share bucket-lookup helpers.
  - `auth.jsx` / `company.jsx` / `branding.jsx` — context providers (branding is public, used pre-login).
  - `i18n.jsx` + `dictionaries.js` — the UI is bilingual (EN/ES); user-facing strings need both translations.

### Agent testing protocol
`test_result.md` contains a protected testing-protocol block ("DO NOT EDIT" markers) and YAML task-status history used to coordinate between a main agent and a testing agent. Preserve the protocol block; append status updates in the prescribed format rather than free-form.

### Emergent replication log (required after every change)
This app also lives on the Emergent platform (https://app.emergent.sh), where its creator maintains a parallel copy. **After completing any feature or change to the application, append a new entry to `PromptsForEmergent.md`** (newest at the bottom): date, one-line summary, and a self-contained copy-pasteable prompt that lets the Emergent AI agent replicate the change without seeing this repo's diffs — describe the change by rule and intent, name the files/components involved, and end with a verification step. **Exclusion:** do NOT log anything related to decoupling this repo from Emergent (direct-Anthropic LLM client, Docker self-hosting, Emergent branding/telemetry removal, dependency swaps) — those must never be replicated into Emergent. Repo-only changes (docs, CLAUDE.md, git housekeeping) don't need entries either; only changes that affect the running application do.
