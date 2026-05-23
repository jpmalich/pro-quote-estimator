# Siding Estimator — PRD (Alside Supply Edition)

## Original Problem & Pivot
User uploaded a self-contained Vinyl Siding Estimator HTML and asked to turn it into an app. After initial build, user revealed they work for **Alside Supply** and intend to distribute this tool to their contractor customers as a value-add. Architecture pivoted to a **supplier-distributed B2B SaaS**:

- **Supplier (Alside Supply / Howard Hunt)** = the platform owner. Provides the app, sets branding, controls signup, ships product catalog.
- **Contractors** = end users. Get an access code from Alside, register their company, upload their own logo, build estimates for homeowners.
- **Homeowners** = see the contractor's branded quote with an optional "Materials supplied by Alside Supply" footer.

## Architecture
- **Backend**: FastAPI + MongoDB. JWT cookie auth (httpOnly, secure, samesite=none). Multi-tenant per Company. Resend for email. Branding stored in `settings` singleton.
- **Frontend**: React 19 + react-router + Tailwind + sonner + lucide. Installable PWA. `BrandingProvider` (public) + `CompanyProvider` (auth'd) share state.
- **Routing**: `/api/branding` public · `/api/admin/*` token-gated · everything else cookie-auth.

## Personas
- **Howard Hunt / Alside sales team** — visits `/branding-admin?token=XXX` to update supplier logo, name, tagline; hands out the contractor access code via email/sales calls.
- **Contractor owner** — registers with access code → uploads own logo → builds estimates → emails quotes to homeowners.
- **Contractor estimator** (teammate) — joins owner's company via 8-char invite code → shares catalog + estimates.
- **Homeowner** — receives a branded quote with optional "Materials supplied by Alside Supply" footer.

## Core Requirements
1. **Invite-only signup** — new companies require `SIGNUP_CODE` (rotatable from `.env`)
2. **Default catalog pre-loaded with Alside Pittsburgh dealer prices** (60+ SKUs from the 2026 5-11 price sheet)
3. **Per-company logo + name + catalog** (each contractor brands their own quotes)
4. **Multi-user companies** — owner can invite teammates via 8-char invite code
5. **Per-company "Powered by Alside Supply" footer toggle** on customer quotes
6. **Hidden supplier-admin URL** (`/branding-admin?token=...`) for Alside to manage their own branding
7. **Quote email via Resend** (configured)
8. **CSV exports** (dashboard summary + per-estimate)
9. **Installable PWA** with mobile-first sticky totals bar

## Live Endpoints
### Public
- `GET /api/branding` — supplier name, tagline, logo (used on Login page)

### Supplier Admin (token gated via `X-Admin-Token` header OR `?token=`)
- `GET /api/admin/signup-code`
- `PUT /api/admin/branding` `{supplier_name?, supplier_tagline?, supplier_logo_url?}`
- `POST /api/admin/upload-logo` multipart `file`

### Contractor (cookie auth)
- `POST /api/auth/register` `{email, password, name?, company_name?, invite_code?, signup_code?}` — needs `signup_code` to create a new company OR `invite_code` to join one
- `POST /api/auth/login` / `logout` / `GET /me`
- `GET /api/company` · `PUT /api/company` `{name?, logo_url?, quote_footer_enabled?}`
- `GET|PUT /api/catalog` · `POST /api/catalog/reset`
- `GET|POST /api/estimates` · `GET|PUT|DELETE /api/estimates/{id}`
- `POST /api/uploads` · `GET /api/uploads/{name}`
- `GET /api/email/status` · `POST /api/estimates/{id}/email`
- `GET /api/exports/estimates.csv` · `GET /api/exports/estimates/{id}.csv`

## Implementation Timeline
- **Iter 1** — MVP build, 17/17 backend tests
- **Iter 2** — Frontend E2E hardening, 16/16 scenarios
- **Iter 3** — Multi-tenant companies, ad-hoc misc lines, CSV exports, Resend live, EstimateEditor refactor, 21/21 tests
- **Iter 4** — Per-company uploadable logo via Team page
- **Iter 5** — **Supplier-distributed pivot**: public branding endpoint, signup-code gating, Alside Pittsburgh dealer prices seeded, /branding-admin route, quote footer toggle, 45/45 tests pass
- **Iter 6** — **4-Tier Material Pricing Architecture** (Feb 2026): 4 supplier-controlled tiers seeded (`one-opp`, `whole-sale`, `Contractor`, `Builder-Dealer`). Material prices locked at backend (PUT /api/catalog strips `mat`) AND at UI (Catalog inputs disabled, EstimateEditor renders mat as static text). Labor remains contractor-editable with orange override + reset. Admin can assign tier per-company via /branding-admin → PUT /api/admin/companies/{id}/tier. 23/23 new pytest tests pass; Playwright validated Catalog tier badge + locked material + BrandingAdmin tier dropdown.
- **Iter 7** — **Margin / Markup toggle on every estimate** (Feb 2026): contractors pick "Margin" (sell = base ÷ (1 − pct)) or "Markup" (sell = base × (1 + pct)) per estimate via a toggle in the Profit settings card. New estimates default to `margin`. Legacy estimates backfilled to `markup` on startup so their historic sell prices are preserved. Live formula preview shows the effective multiplier (e.g. "×1.429" at 30% margin vs "×1.300" at 30% markup). CSV exports include the mode + percent. Verified via curl: $1500 base @ 30% → $2142.86 margin, $1950.00 markup.

## Configuration (`backend/.env`)
- `SUPPLIER_NAME=Alside Supply`
- `SUPPLIER_TAGLINE=Howard Hunt · Territory Sales Manager · (724) 640-4333`
- `SIGNUP_CODE=ALSIDE-JR47Q8`     ← rotate this whenever you want
- `SUPPLIER_ADMIN_TOKEN=OXSp1EX...` ← used in `/branding-admin?token=...`
- `RESEND_API_KEY=re_15w1DRpa...`
- `ADMIN_EMAIL=admin@wolfandson.com` / `ADMIN_PASSWORD=Admin123!`

## Backlog
### P1
- Real PWA app icons (still programmatic placeholder)
- Server-side PDF rendering of customer quote (perfectly identical output across browsers)
- "Sync to latest supplier catalog" admin action to push price updates to opt-in companies

### P2
- Role-based catalog editing (owner-only)
- Customer / contact directory + e-sign capture
- Quote status workflow (draft → sent → won/lost)
- Cloudinary photo CDN
- Stripe billing if Alside ever monetizes the tool
- Lead-source field + "$ profit closed by channel" dashboard (contractor analytics)

### Nice-to-haves
- Reject unsupported MIME on logo uploads with 415 instead of silently coercing
- `hmac.compare_digest` for admin token check
- Migrate deprecated `@app.on_event` → lifespan
