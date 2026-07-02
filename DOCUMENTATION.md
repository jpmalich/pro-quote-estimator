# Pro-Quote Estimating Tool — Application Documentation

> Compiled from analysis of the codebase, the project's PRD (`memory/PRD.md`), and a recorded
> conversation with the application's creator, Howard "Howie" Hunt
> (`Resource_Docs/ConversationWithHowie.mp3`, transcript alongside it).

---

## 1. What This Application Is

**Pro-Quote** is a multi-tenant, supplier-distributed B2B SaaS estimating tool for exterior
remodeling — vinyl/composite siding and replacement windows. It lets a contractor measure a house
(from phone photos, a HOVER report PDF, architectural blueprints, or satellite imagery), produces a
complete priced material + labor takeoff, and sends a branded quote to the homeowner, who can
accept it online.

Its core value proposition, in the creator's own words: it does what **HOVER** (the industry-standard
photo-measurement service) does for **roughly $0.13–$0.30 per AI measurement run instead of ~$150
per HOVER report** — "I just don't get all the pretty pictures."

### Origin

Howard Hunt is a Territory Sales Manager for **Alside Supply** (a building-products supplier in the
Pittsburgh area). He built this app himself on the **Emergent** AI app-building platform over a
period of months, iterating continuously. The business model that emerged:

- **Alside Supply (the supplier)** owns the platform, seeds it with its dealer price sheet, controls
  who can sign up, and brands the login page.
- **Contractors** (Alside's customers) receive an access code, register their own company, upload
  their own logo, and quote jobs to homeowners under their own brand.
- **Homeowners** receive the contractor-branded quote by email, with an optional
  "Materials supplied by Alside Supply" footer, and can accept it from a public link.

The strategic upside discussed in the conversation: contractors who quote faster sell more (and buy
more material from Alside); an LP SmartSide executive who saw a demo suggested a manufacturer might
pay six figures for the tool, and Alside was considering demoing it at its national top-contractor
meeting.

### Where It Runs

| Environment | URL |
|---|---|
| Production (published) | `app.pro-quotes.com` |
| Build preview (Emergent) | `app-converter-170.preview.emergentagent.com` |

Hosting on Emergent costs on the order of **$10/month** in platform credits, plus per-run AI costs
(photo measure ~13–30¢; blueprint runs at the top of that range because of multi-pass AI calls).

---

## 2. Users & Personas

| Persona | How they use it |
|---|---|
| **Supplier admin** (Howard / Alside sales team) | Hidden admin page at `/branding-admin` (token-gated). Manages supplier branding, the contractor signup code, the four price tiers, per-company tier assignment, bulk price updates (CSV/XLSX upload or across-the-board % bump), and sends branded contractor invitations. Sees quote *counts* per company, deliberately not quote contents. |
| **Contractor owner** | Registers with the supplier's access code → creates a company → uploads logo → sets labor rates in the Catalog → builds estimates → emails quotes → tracks opens/clicks/acceptance. |
| **Contractor teammate** | Joins the owner's company with an 8-character invite code; own login, shared company catalog and estimates. |
| **Homeowner** | Receives the quote email; opens a public accept page (`/accept/:token`), reviews the branded quote (English or Spanish), and accepts with an optional note — which emails the contractor back. |

---

## 3. Usage

### 3.1 Getting started (contractor)

1. **Register** at `/login?mode=register`. Creating a *new* company requires the supplier's signup
   code (e.g. `ALSIDE-XXXXXX`, rotatable via env); *joining* an existing company requires that
   company's invite code instead.
2. **Set up your company** on the **Team** page: company name, logo upload, and copy your invite
   code for teammates.
3. **Set labor rates** on the **Catalog** page. Material prices come from the price tier the
   supplier assigned to your company (shown as a locked "Tier" badge); labor and per-line material
   overrides are yours. Saved catalog values flow into every subsequent estimate.
4. **Create an estimate.** The home screen is a workspace picker:
   - **ISS Quotes** → ISS Siding, ISS Windows (ISS uses its own simplified single-price catalog/editor)
   - **Contractor Quotes** → Vinyl + Ascend Siding, LP SmartSide (beta), Window Quotes

### 3.2 Building an estimate

The estimate editor is organized as **product-line tabs** over shared **sections** of line items:

| Tab | Product |
|---|---|
| Vinyl | Vinyl siding (Alside) |
| Ascend | Alside's composite siding product |
| LP Smart | LP SmartSide engineered wood (separate manufacturer) |
| Vero *(tab id `windows`)* | Vero replacement windows |
| Mezzo | Mezzo (Alside 3000-series) replacement windows |

Key editor concepts:

- **Sections & lines** — collapsible accordions (Vinyl Siding, Siding Accessories, Tear-Off /
  Clean-Up, Window Installation, …) each containing catalog line items with qty × material × labor.
- **Yellow "lightbulb" rows** — items you *almost always* need. A badge on each section header
  counts highlighted items still at qty 0, so essentials (pocket install, coil, caulking…) don't
  get forgotten.
- **Window openings** — windows are quoted per-opening (width × height mapped to a United-Inches
  price bucket) with per-opening upgrade adders (glass packages, tempered, ClimaTech, etc.). The
  same physical openings are quoted side-by-side in both Vero and Mezzo so the contractor can
  present both brands. Bulk-apply prompts propagate an upgrade across all uploaded windows.
- **Waste, tax, margin** — waste % is baked into cut-prone line quantities (raw qty preserved for
  recompute), sales tax applies to material, and the sell price is computed in either **margin**
  mode (`base / (1 − pct)`) or **markup** mode (`base × (1 + pct)`).
- **Misc rows** — free-form labor/material rows per tab.
- **Autosave** — edits save automatically ~2 s after you stop typing, plus flushes on page
  hide/close; an explicit Save button confirms with a toast.

### 3.3 Measuring the house (four input paths)

All four paths converge to the same result shape: extracted measurements + a proposed set of
catalog lines, shown in a **preview/reconciliation card** before anything touches the estimate.

1. **AI Photo Measure** — take up to 8 photos walking around the house (front, front-left, left,
   back-left, back-right, right, front-right…). Give the AI one known reference dimension (a wall
   length or a window width) so it can scale the scene, optionally annotate photos (reference line,
   "no-siding" zones for brick/garage areas, profile tagging). Claude vision extracts wall/soffit/
   fascia/gutter/opening measurements and the app generates the full material list.
2. **HOVER PDF import** — upload an existing HOVER measurement report PDF; the backend parses it
   (pdfplumber + Claude) into measurements and auto-fires mapped catalog lines
   (`HOVER_MAPPING_SPEC`), including standard job fees. A "Deep Verify" vision pass can re-check
   values against the rendered PDF pages.
3. **AI Blueprint measure** — upload architectural plan sheets (PDF/images); Claude reads the
   printed dimensions and the window schedule.
4. **Satellite/aerial** — fetch an aerial tile for the job address (Google geocoding + Esri/Google
   imagery) as an additional measurement source, with a crosshair to pin the target house.

Windows found by an import are routed to a **paired windows estimate** (a siding estimate and a
windows estimate linked as one job); an LP pairing exists as well. A **Compare Drawings** modal
renders elevation drawings from all sources side-by-side and flags drift ≥ 2 ft so the contractor
can spot disagreement between sources before quoting.

### 3.4 Quoting and closing

- **Customer Quote** — branded HTML quote (contractor logo, optional supplier footer), previewable,
  printable, downloadable as PDF (WeasyPrint server-side render), and emailable via Resend.
- **Tracking** — Resend webhooks feed a per-quote pipeline: **Sent → Opened → Clicked → Accepted**,
  visible on the dashboard.
- **Accept page** — the homeowner's public link renders the quote (EN/ES) and records acceptance
  with an optional note; the contractor is notified by email.
- **Material list** — a separate printable list of just the parts/quantities, which the contractor
  can send to the supplier to place the material order.
- **CSV export** — all estimates (dashboard summary) or a single estimate.
- **Print takeoff / measurement report PDF** — printable measurement breakdowns for the file.

### 3.5 Supplier price maintenance

From `/branding-admin` (with the admin token), pricing is maintained through diff-previewed flows:

- **Quick Bump** — e.g. +3% material across all tiers.
- **Upload** — CSV/XLSX of new prices (matches Howard's Excel price-sheet workflow).
- **Export** — download current prices.
- Separate matrix editors for Mezzo and Vero window pricing and the ISS catalog.
- Company → tier assignment (four tiers seeded from the Alside Pittsburgh dealer price sheet:
  one-opp, Builder-Dealer, Contractor, wholesale).

---

## 4. Workflow Summary

```
Supplier admin                     Contractor                              Homeowner
──────────────                     ──────────                              ─────────
Set branding, signup code   →      Register w/ access code
Assign price tier                  Upload logo, set labor rates
Maintain tier prices               Create estimate (siding/windows/ISS)
(CSV / % bump / matrices)          Measure: photos | HOVER PDF |
                                     blueprint | satellite
                                   Review takeoff preview → apply
                                   Adjust lines, openings, adders,
                                     waste / tax / margin
                                   Email quote ────────────────────→      Open quote (tracked)
                                   Watch pipeline: sent/opened/           Accept w/ note
Sees quote counts per company  ←── clicked/accepted        ←──────────────┘
                                   Print material list → order from supplier
```

---

## 5. Architecture

### 5.1 High level

```
┌────────────────────────────┐        ┌──────────────────────────────────┐
│  React 19 SPA (CRA/craco)  │  HTTPS │  FastAPI backend (/api)          │
│  Tailwind + Radix/shadcn   │ ─────► │  JWT cookie auth · multi-tenant  │
│  PWA (manifest + SW)       │        │  routes/ per feature             │
│  EN/ES i18n · three.js     │        └───────┬──────────────────────────┘
└────────────────────────────┘                │ Motor (async)
                                              ▼
                                        MongoDB (16 collections)
                                              │
              ┌───────────────┬───────────────┼──────────────┬─────────────┐
              ▼               ▼               ▼              ▼             ▼
        Anthropic Claude   Resend email   Google Maps    WeasyPrint   Upload store
        (vision measure,   (quotes,       geocode +      (HTML→PDF)   (disk + Mongo
        PDF parsing via    webhooks/      satellite                    blob mirror,
        emergentintegr.)   Svix)          imagery                      self-healing)
```

### 5.2 Backend (`backend/`)

- **FastAPI** app (`server.py`) mounting `routes.api_router` under `/api`; CORS locked to an
  explicit allowlist (fail-closed, wildcard stripped when credentials are on).
- **Feature-per-module routers** in `routes/`: auth, company, catalog (+tier admin), estimates,
  uploads, email, public accept, Resend webhook, branding admin, pricing admin, HOVER import,
  Mezzo/Vero/ISS catalogs and pricing, LP admin preview, AI measure (+sessions), AI blueprint,
  satellite, measurement report.
- **`services.py`** — the pricing engine (`calc_totals`) and tenant/seeding helpers; the largest
  business-logic file (~72 KB).
- **`startup.py`** — idempotent boot: index creation (incl. TTL indexes on async-run collections),
  tier/Mezzo/Vero/admin seeding, schema migrations.
- **`deps.py`** — bcrypt password hashing, JWT create/verify, httpOnly cookie management,
  header-only admin-token check.
- **`pdf.py`** — WeasyPrint rendering with an SSRF-hardened URL fetcher (only `data:` and HTTPS to
  public IPs; blocks file://, private ranges, cloud metadata).
- **`upload_store.py`** — every upload is mirrored into a MongoDB blob collection so files survive
  ephemeral-container disk loss; the serve route self-heals disk from Mongo.
- **Async AI runs** — photo measure, blueprint, and HOVER imports run as background jobs with
  status-polling endpoints and 24 h TTL run documents.

### 5.3 Frontend (`frontend/`)

- **React 19** (Create React App + craco), react-router v7, axios (`withCredentials`), Tailwind +
  Radix/shadcn `components/ui`, sonner toasts, three.js for 3D elevation previews, zod +
  react-hook-form.
- **Provider tree**: `LangProvider → AuthProvider → BrandingProvider → CompanyProvider → Router`.
  Branding loads publicly (login page shows supplier branding before auth).
- **Domain logic lives in `src/lib/`**, not components: `useEstimate.js` (catalog-merge + autosave
  state machine), `calc.js` (totals), `tabsConfig.js` (tab visibility single source of truth),
  `wasteLogic.js`, `photoAnnotate.js`, `elevation3D.js`/`elevationBuilder.js`, `emailQuote.js`,
  `materialList.js`, `printTakeoff.js`, `i18n.jsx` + `dictionaries.js`.
- **Installable PWA**: manifest + cache-first service worker (never caches `/api`), iOS/Android
  install banner, mobile-first sticky totals bar. Designed for phone/tablet use in the field.
- **Bilingual** English/Spanish throughout, including the customer-facing quote and accept page.

### 5.4 External integrations

| Service | Used for | Notes |
|---|---|---|
| **Anthropic Claude** (via Emergent's `emergentintegrations` LLM layer) | All vision/measurement AI: photo measure, blueprint reading, HOVER PDF parsing, cross-checks, OCR scale detection | Opus-class model for vision runs; Sonnet-class for HOVER text parsing. Keyed by `EMERGENT_LLM_KEY`. |
| **Resend** | Quote emails, acceptance notifications, contractor invites; delivery/open/click webhooks (Svix-verified) | Verified sending domain `pro-quotes.com` (SPF/DKIM/DMARC). |
| **Google Maps** | Geocoding + satellite imagery for aerial measure | `GOOGLE_MAPS_API_KEY`. |
| **HOVER** | Not an API integration — contractors upload HOVER PDFs they already own | Positioning: this app *replaces* new HOVER purchases. |

---

## 6. Database

MongoDB (async via Motor). Connection from `MONGO_URL` / `DB_NAME`. Collections:

| Collection | Purpose |
|---|---|
| `users` | Contractor + admin accounts (bcrypt hash, role, company_id; unique email) |
| `companies` | Tenants: name, owner, 8-char invite code, logo, assigned price tier, quote-footer toggle |
| `estimates` | The core document: customer/job info, per-tab line items, misc rows, Mezzo/Vero openings, colors, waste/tax/margin, pairing ids, HOVER/AI measurements, email tracking events, acceptance record |
| `catalogs` | Per-company labor/material *override deltas* (base material prices come from the tier) |
| `price_tiers` | The 4 supplier price tiers, each a full sectioned catalog (mat/lab/SKU per item) |
| `mezzo_prices` | Mezzo window price matrices per (tier × product type): size-bucket base prices + adder prices |
| `vero_prices` | Vero window price docs per (tier × product type), seeded from `vero_seed_prices.json` |
| `iss_catalog` | Single-tier ISS price book |
| `settings` | Singleton supplier-branding document |
| `invitations` | Contractor invites sent from the admin panel |
| `ai_measure_runs` / `ai_blueprint_runs` / `hover_import_runs` | Async AI job status + results (TTL 24 h) |
| `ai_measure_sessions` | In-progress photo-measure working state, one per estimate |
| `hover_page_cache` | Rendered PDF page images for Deep Verify (TTL 1 h) |
| `upload_blobs` | Byte-level mirror of uploaded files (disk-loss recovery) |

**Multi-tenancy** is enforced by `company_id` scoping on every contractor query. **Indexes and TTLs**
are created idempotently at startup.

> ⚠️ **Backups**: no automated MongoDB backup/restore strategy exists in the codebase. This was
> flagged in the recorded conversation as an open operational risk (accidental deletion of a
> customer quote is currently unrecoverable). See §10.

---

## 7. API Overview

All endpoints are under `/api`. Three auth levels:

- **Public** — `GET /branding`, `GET|POST /public/accept/{token}`, `POST /public/resend-webhook`
  (Svix-signature-verified), `GET /uploads/{name}`, auth register/login.
- **Contractor (JWT httpOnly cookie)** — company, catalog, estimates CRUD + duplicate/pair,
  uploads, quote email + PDF, CSV exports, Mezzo/Vero/ISS catalogs, and the measurement suite under
  `/measure/*` (AI measure, sessions, blueprint, satellite tile, report PDF) plus HOVER import +
  status polling.
- **Supplier admin (`X-Admin-Token` header — never in the URL)** — branding, signup code,
  invitations, tier CRUD + company-tier assignment, pricing bump/upload/export, Mezzo/Vero/ISS
  price editors, cross-company pipeline stats.

Full endpoint-by-endpoint detail: see `memory/PRD.md` ("Live Endpoints") and the routers in
`backend/routes/`.

Security posture (hardened across a dedicated SEC-001…SEC-007 audit series):

- CORS fail-closed allowlist; no wildcard with credentials (SEC-001)
- SSRF-hardened PDF asset fetching (SEC-002)
- Magic-byte upload validation (SEC-003)
- Fail-closed secrets: boot refuses to start with a short `JWT_SECRET` or empty `ADMIN_PASSWORD` (SEC-004)
- Login rate limiting: 5 failed attempts / IP / 15 min → 429 (SEC-005)
- Admin token accepted in header only (URL tokens leak via logs/history) (SEC-006)
- Strict per-user ownership of AI runs (SEC-007)

---

## 8. System Requirements

### Server / development

| Component | Requirement |
|---|---|
| Python | 3.11 (ruff `target-version = "py311"`) |
| Node.js + Yarn | Yarn 1.22.x (pinned via `packageManager`); CRA 5 / react-scripts |
| MongoDB | Any Motor/pymongo-4-compatible instance; TTL index support |
| WeasyPrint system deps | Pango/Cairo/GDK-PixBuf native libraries (for PDF rendering) |
| Outbound network | api.anthropic.com (via Emergent LLM proxy), api.resend.com, maps.googleapis.com |

**Required environment (backend `.env`)** — the server *fails closed at import* without the
critical ones:

| Variable | Required | Purpose |
|---|---|---|
| `MONGO_URL`, `DB_NAME` | ✅ | Database connection |
| `JWT_SECRET` | ✅ (≥ 32 chars) | Session signing |
| `ADMIN_PASSWORD`, `ADMIN_EMAIL` | ✅ | Seeded supplier-admin account |
| `CORS_ORIGINS` | ✅ (else all cross-origin refused) | Explicit origin allowlist |
| `SUPPLIER_ADMIN_TOKEN` | for admin panel | `X-Admin-Token` value |
| `SIGNUP_CODE` | recommended | Contractor access code (stable fallback derived from JWT_SECRET) |
| `EMERGENT_LLM_KEY` | for AI features | Claude access via Emergent |
| `RESEND_API_KEY`, `SENDER_EMAIL`, `RESEND_WEBHOOK_SECRET` | for email | Quote sending + tracking |
| `GOOGLE_MAPS_API_KEY` | for satellite measure | Geocode + imagery |
| `JWT_TTL_SECONDS` | optional (default 7 days) | Session length |
| `LP_AI_FORMULAS_V1` | optional flag | New LP quantity formulas |

**Frontend env**: `REACT_APP_BACKEND_URL` (the only one) — base URL of the backend.

### Client

- Any modern evergreen browser; mobile-first design targeted at **phones and tablets** in the field.
- Installable as a PWA (Add to Home Screen on iOS/Android); static shell works cache-first offline,
  but all data operations require connectivity.

### Running locally

```bash
# Backend
cd backend
pip install -r requirements.txt          # needs WeasyPrint native libs present
# create .env with the required variables above
uvicorn server:app --reload              # http://localhost:8000

# Frontend
cd frontend
yarn install
echo "REACT_APP_BACKEND_URL=http://localhost:8000" > .env
yarn start                               # http://localhost:3000
```

Tests and linting:

```bash
cd backend && ruff check . && pytest tests/    # HTTP integration tests — need a running
                                               # deployment + SIGNUP_CODE/TEST_* env vars,
                                               # otherwise they skip cleanly
cd frontend && npx eslint src
node frontend/src/lib/wasteLogic.test.mjs      # pure-logic regression test
```

---

## 9. Operating Costs (as reported by the creator)

| Item | Cost |
|---|---|
| Hosting (Emergent platform) | ~$10/month in credits |
| AI photo-measure run | ~$0.13–0.16 per run |
| AI blueprint run | ~$0.20–0.30 per run (multiple AI round-trips) |
| Comparison: HOVER report | ~$150 per report |

---

## 10. Known Gaps, Risks & Roadmap

From the recorded conversation and the project's own backlog (`memory/REMINDERS.md`, PRD backlog):

**Operational risks (raised in the conversation)**
- **No MongoDB backup/restore plan** — a deleted or corrupted quote is unrecoverable today.
- **Accessibility** — no color-blind-safe palette or accessibility audit; noted as a hard
  requirement for any government-adjacent adoption (Section 508-type review would fail today).
- **Secrets hygiene** — an Anthropic API key was exposed in a chat session and should be rotated;
  the signup code should be rotated whenever distribution changes; test-era admin credentials
  appear in historical docs.

**Product gaps acknowledged by the creator**
- No HOVER-style polished 3D rendering of the house (the AI cannot yet draw it reliably).
- AI cannot distinguish J-block variants (light/split/UL/jumbo/dri-vent) — contractors adjust
  these lines manually.
- Pricing updates still driven by a multi-tab Excel workflow the creator finds clunky.
- No per-section rollup totals in the editor (deemed low-priority — "most guys just care about the
  final number").
- UI theming — a future "pick your look & feel" settings panel was suggested.

**Backlog highlights (PRD / REMINDERS)**
- Stripe deposit on the accept page (P0)
- Real PWA app icons (currently programmatic placeholders)
- Server-side pixel-perfect PDF for all browsers
- Supplier conversion dashboard (quoted vs ordered $ per SKU across contractors)
- "Sync all contractors to latest tier prices" bulk admin action
- Quote status workflow (draft → sent → won/lost), customer directory, e-sign capture
- Possible product split: separate siding and windows apps

---

## 11. Repository Map

```
app-convertor/
├── backend/               FastAPI app (see §5.2) — routes/, services.py, startup.py,
│                          seed data (catalog_seed.py, vero_*, mezzo_*, iss_catalog.py),
│                          tests/ (HTTP integration tests)
├── frontend/              React SPA (see §5.3) — src/pages, src/components, src/lib
├── memory/                PRD.md (full product history, iteration log) · REMINDERS.md (backlog)
├── Resource_Docs/         ConversationWithHowie.mp3 + transcript
├── test_reports/          Historical test-run reports
├── test_result.md         Agent testing protocol + task status log (protected format)
├── CODE_QUALITY.md        Lint philosophy — what reviewers should and should not flag
├── CLAUDE.md              Guidance for AI coding agents working in this repo
├── design_guidelines.json Visual design tokens/guidelines
└── source.html            The original self-contained HTML estimator the app grew from
```
