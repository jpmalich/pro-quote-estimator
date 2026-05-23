# Vinyl Siding Estimator — PRD

## Original Problem
User uploaded a self-contained HTML "Vinyl Siding Estimator" used by Wolf and Son Renovations LLC and asked: "what do i need to do with the attached html to make it an app". Selected: installable PWA + Web app (React/FastAPI/MongoDB), persistence + saved estimate list, multi-user JWT login, edit catalog from UI, photo uploads (local disk), email quote via Resend, modernize design.

## Architecture
- **Backend**: FastAPI + MongoDB (motor), bcrypt + PyJWT cookie auth (httpOnly, secure, samesite=none), Resend SDK lazy-loaded for email, multi-tenant via `Company` model
- **Frontend**: React 19 + react-router-dom v7 + Tailwind + sonner + lucide-react, installable PWA, Archivo + JetBrains Mono fonts, Swiss/Industrial brutalist design (stark white + safety-orange + black)
- **Tenancy model**: `User → Company (1:N)` → `Catalog (1:1 per company)` + `Estimates (1:N per company)`. Catalog seeded with the 60+ items from the original HTML on company creation. Users join by invite code or create a new company on register.
- **Storage**: MongoDB collections `users`, `companies`, `catalogs`, `estimates`. Photos on disk under `/app/backend/uploads/`, served via `/api/uploads/{name}`.
- **Routing**: All backend endpoints under `/api`; frontend uses `${REACT_APP_BACKEND_URL}/api`.

## User Personas
- **Contractor / Estimator** (primary): on a phone/tablet at jobsite typing quantities; live Sell Price & Profit always visible; emails quote to homeowner
- **Owner / Admin**: edits price catalog, invites teammates, exports CSV for accounting
- **Teammate**: joins existing company via invite code, sees shared catalog + estimates

## Core Requirements
1. Multi-user JWT email/password authentication
2. Multi-tenant: each user belongs to a Company; catalog & estimates scoped to company
3. Editable per-company price catalog seeded with the 60+ items from original HTML
4. Live recalculation: Base, Sell Price, Profit update on every keystroke
5. Customer-facing printable + emailable quote (via Resend)
6. Photo uploads attached to a job
7. Installable PWA (mobile-first, sticky totals bar)
8. CSV export — dashboard summary + per-estimate detail
9. Ad-hoc "misc line" rows for the two Misc sections (matching original HTML)

## Implemented (2026-05-23)
### Iteration 1 — MVP build
- Auth (register/login/logout/me), httpOnly cookies, admin seed
- Estimates CRUD, catalog seed (60+ items), photo uploads, email stub
- Modern Swiss/Industrial UI, PWA manifest + service worker
- **Backend 17/17 tests passed**

### Iteration 2 — E2E hardening
- Frontend E2E coverage of every flow
- CORS tightened to explicit origins; logout cookie clearing fixed
- **Frontend 16/16 scenarios passed**

### Iteration 3 — Production features
- **Resend email** wired with real API key — quote send works end-to-end
- **Multi-tenant Companies**: `/api/auth/register` accepts `company_name` (creates) OR `invite_code` (joins); `/api/company` returns invite code; catalogs + estimates auto-scoped via `company_id`
- **Ad-hoc misc lines** in "Misc. Labor Only" (lab only) and "Misc. Labor & Material" (mat + lab) sections, persisted via `misc_labor` and `misc_material` arrays
- **CSV export**: `/api/exports/estimates.csv` (all) + `/api/exports/estimates/{id}.csv` (detailed) with Save/Print/Quote/Export buttons
- **EstimateEditor refactor**: extracted `useEstimate` hook + 6 sub-components (StickyBar / JobInfoPanel / SettingsRow / PhotosPanel / SectionAccordion / TotalsSummary) + `calc.js` util
- **Team page** showing company name + invite code with copy-to-clipboard
- Stable `_id` keys on misc rows; blob URL revoke race fix on CSV downloads
- **Backend 21/21 tests passed**, **Frontend 95% (no app bugs, only Playwright click flake)**

## Live Endpoints
### Auth
- `POST /api/auth/register` `{email, password, name?, company_name?, invite_code?}`
- `POST /api/auth/login` `{email, password}` — sets httpOnly cookie
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Company / Catalog / Estimates
- `GET /api/company`
- `GET|PUT /api/catalog` · `POST /api/catalog/reset`
- `GET|POST /api/estimates` · `GET|PUT|DELETE /api/estimates/{id}`

### Files / Email / Exports
- `POST /api/uploads` (multipart) · `GET /api/uploads/{name}`
- `GET /api/email/status` · `POST /api/estimates/{id}/email`
- `GET /api/exports/estimates.csv` · `GET /api/exports/estimates/{id}.csv`

## Prioritized Backlog
### P1
- [ ] PWA app icons designed (currently programmatic placeholder)
- [ ] Internal PDF export (server-side render so it's identical across browsers)
- [ ] Estimate duplicate / template

### P2
- [ ] Role-based catalog edit (only owners/admins)
- [ ] Customer / contact directory
- [ ] Lead-source field + simple "$ profit closed by channel" dashboard
- [ ] Estimate status workflow (draft → sent → won/lost)
- [ ] Quote signature & e-sign capture
- [ ] Cloudinary swap for photo storage (CDN delivery)

### Nice-to-haves
- [ ] Migrate `@app.on_event` to lifespan context manager (deprecation warning)
- [ ] MIME validation on uploads (currently extension-only)
- [ ] Per-row stable id + collision-retry on invite_code creation
