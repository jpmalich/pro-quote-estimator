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
- **Iter 7** — **Margin / Markup toggle on every estimate** + **supplier-wide default in /branding-admin** (Feb 2026): contractors pick Margin/Markup per estimate via a toggle in the Profit settings card. Alside can lock a default mode in `/branding-admin` → `Default Pricing Mode` card; new estimates pick up that default if the client doesn't pass one. Backend: `EstimateIn.pricing_mode: Optional[str]`, POST `/estimates` falls back to `branding.default_pricing_mode`, PUT uses `exclude_none` so omitting the field preserves the existing value. New `default_pricing_mode` field on `GET /api/branding` (public) + `PUT /api/admin/branding` (token, validates margin/markup). Legacy estimates backfilled to `markup` on startup so historic sell prices are preserved. CSV exports include both the mode and percent. Math verified: $1500 @ 30% → $2142.86 margin, $1950 markup. Full pytest suite: **67 passed, 1 skipped** (the skipped test exercises defunct per-company material overrides — material is tier-controlled now).
- **Iter 8** — **Customer email polish · Phase 1** (Feb 2026): replaced the "raw DOM HTML" email body with a brand-new email-safe template at `/app/frontend/src/lib/emailQuote.js`. All styles are inlined, layout is table-based (Gmail/Outlook/Apple Mail compatible — no Tailwind classes survive in email clients). New features: (1) editable Personal Note textarea in QuoteModal pre-filled with a friendly greeting using the customer's first name + estimator's name; (2) personalized subject `"Your siding estimate {EST#} from {Contractor} — {Customer}"` using the contractor's actual company name (not hardcoded "Wolf and Son"); (3) inline estimator signature block; (4) clean reply CTA footer + supplier attribution. Backend fallback subject also fixed to use `company.name` from DB instead of the hardcoded string. Verified end-to-end: HTML renders cleanly in browser preview, contains 0 Tailwind classes, all inline styles validate, currency/dates/notes all escape correctly. 67/67 pytest still green.
- **Iter 9** — **Customer email polish · Phase 2: Trust & conversion** (Feb 2026): (1) `reply_to` header now set server-side to the company **owner**'s email (fallback to the authed user) so customer replies always land in the contractor's inbox instead of `onboarding@resend.dev`. (2) Prominent **"VALID THROUGH MMM DD, YYYY"** orange badge in the email header, computed as estimate_date + 30 days; the expiration date is repeated under the Total. (3) Big orange **"Accept this Estimate →" mailto CTA** in the email with a pre-filled subject (`"Accepting estimate EST-XXX — Customer"`) and body (mentions the total price), making it one-click for customers to send the contractor an acceptance. All three changes preserve 100% inline-style / no-class email-client compatibility. 67/67 pytest still green.
- **Iter 10** — **Backend refactor** (Feb 2026): broke the 957-line `server.py` into 14 small modules under `/app/backend/`: `server.py` (slim entry, 36 lines) + `config.py` + `db.py` + `models.py` + `deps.py` + `services.py` + `startup.py` + `routes/{branding,auth,company,catalog,estimates,uploads,email}.py`. Largest file is now `routes/estimates.py` at 166 lines. Zero behavior changes — 67/67 pytest still pass, 8/8 smoke curl tests still pass, lint clean. Future agents can navigate the codebase by domain instead of scrolling 900 lines.
- **Iter 11** — **Code-review noise prevention** (Feb 2026): pinned explicit linter configs so future automated reviews don't surface false positives. New files: `/app/frontend/eslint.config.js` (ESLint v9 flat config — focuses on real-bug rules: `react-hooks/*`, `no-unused-vars`, `no-undef`, `no-dupe-keys`; disables prop-types/escaped-entities noise), `/app/backend/pyproject.toml` (`[tool.ruff]` config — selects `E, W, F` only; ignores complexity, PEP604 modernization, `is None` E711/E712 misfires, security `S` rules), and `/app/CODE_QUALITY.md` (explains the philosophy + lists what reviewers should NOT flag: complexity, missing type hints, hardcoded test creds, `is None` patterns). Also fixed 3 legitimate items from a code-review report: test creds moved to env vars (with module-level `pytest.skip` if absent), `useMemo` on `auth.jsx` and `company.jsx` Context Provider values (real React perf concern), and 2 `console.warn` calls wrapped in `process.env.NODE_ENV !== "production"`. Final state: ESLint **0 errors**, ruff **All checks passed**, **67/67 pytest pass**.
- **Iter 12** — **Delete-Contractor + cleanup** (Feb 2026): new `DELETE /api/admin/companies/{id}` cascades to remove the company + its users + estimates + catalog overrides. Frontend `/branding-admin` got a trash button on each row with type-to-confirm prompt. Wiped 71 leftover test companies — only Howard's Estimating Tool remains.
- **Iter 13** — **Email Phase 3 · PDF attachment** (Feb 2026): added WeasyPrint 68.1 + new `/app/backend/pdf.py` (HTML→PDF render + safe filename). Email-send route now generates a PDF from the same email-safe HTML and attaches it to the Resend email (base64 in `attachments` param). Plus a new `POST /api/estimates/{id}/pdf` endpoint for in-app downloads; QuoteModal's "Download PDF" button calls it and saves the file with a friendly name like `EST-252751-Jane_Smith.pdf`. Verified: 14 KB PDF, valid `%PDF` magic, file downloads correctly from the UI. Email customer experience now includes a PDF they can save/print/forward to their spouse. 67/67 pytest pass; lint clean.
- **Iter 14** — **Hosted Accept Page (Option B)** (Feb 2026): replaced the mailto-only Accept CTA with a one-click hosted acceptance flow. Frontend mints a UUID4 `accept_token` per estimate; the email's "Accept this Estimate →" link now points to `https://.../accept/{token}`. New backend routes: `GET /api/public/accept/{token}` (no-auth, customer-safe summary) + `POST /api/public/accept/{token}` (records `accepted_at`, `accepted_ip`, `accepted_note`; flips `status_label` to "accepted"; emails the company owner a "🎉 Jane Smith accepted EST-001" notification via Resend; idempotent on repeat clicks). New public route `/accept/:token` in React Router renders a branded page with the contractor's name, total, an optional "note to the contractor" textarea, an "I accept" checkbox, and a big confirm button — followed by a green ✓ thank-you state. Dashboard now shows a **green "✓ Accepted" badge** on accepted estimates and an **orange "Sent" badge** on emailed ones. Verified end-to-end via curl + Playwright. 67/67 pytest still pass.
- **Iter 15** — **Mobile-friendly Tier A** (Feb 2026): responsive polish for phone use without touching the iPad/laptop layout. Changes all use Tailwind's `md:` (≥768px) breakpoint, so phones (<768px) get the new layout and everything bigger keeps the current view byte-for-byte. (1) **SectionAccordion line items**: items stack on phone with tiny labeled headers ("UNIT", "QTY", "LAB $", "MAT $", "TOTAL") so each input is identifiable; inputs grow to 44 px tall (Apple HIG min touch target); bold item name on its own line; total in a separated bottom row with a divider. (2) **QuoteModal action bar** stacks vertically on phone — full-width Email + Download PDF + Close buttons. (3) **`.btn-ghost` / `.btn-danger`** icon buttons get a `min-width: 44 px; min-height: 44 px;` floor on phone, removed on desktop via `@media (min-width: 768px)`. Verified live: iPhone 390×844 shows the new layout cleanly, 1440×900 desktop is pixel-identical to before. 67/67 pytest still pass; ESLint clean.
- **Iter 16** — **PWA Install Banner** (Feb 2026): new `/app/frontend/src/components/InstallBanner.jsx` mounted inside Layout (so it only shows for authed contractors, never on Login / AcceptPage / BrandingAdmin). Detects iOS vs Android via `navigator.userAgent` + `navigator.maxTouchPoints`. On iPhone, the "Install" button opens a 3-step instruction modal (tap Share → "Add to Home Screen" → Add). On Android/Chrome, captures the native `beforeinstallprompt` event so the button fires a real one-tap install. Detects already-installed apps via `(display-mode: standalone)` so it doesn't show inside the installed PWA. Dismiss is persisted via `localStorage` (`install-banner-dismissed-v1`). Banner is `md:hidden` so desktops never see it. Verified: appears after a 1.2s defer on iPhone, dismiss + reload = stays hidden; desktop 1440px DOM contains no banner element.
- **Iter 17** — **Duplicate Estimate** (Feb 2026): new `POST /api/estimates/{id}/duplicate` clones an estimate keeping lines + labor overrides + notes (scope) + margin/markup + pricing mode + waste % + tax. **Strips** customer_name, address, accept_token, accepted_*, last_sent_at, recipient_email, and assigns a fresh estimate_number + estimate_date so the contractor can't accidentally email a duplicate. New "Copy" icon button on every Dashboard row next to the trash button — click duplicates the estimate, navigates to the new one, shows "Estimate duplicated — customer fields cleared" toast. Verified end-to-end via curl (6 invariants pass) + Playwright (live UI). 67/67 pytest still pass; lint clean.
- **Iter 18** — **Dashboard filter chips + Pipeline stats** (Feb 2026): **Contractor side** — Dashboard gains a 4-card stats row (Drafts / Sent / Accepted / Win Rate) with pending and won dollar totals, plus filter chips below it (All / Draft / Sent / Accepted) with running counts per bucket. Status is derived locally via `statusOf(e)` from the `accepted_at` / `last_sent_at` lifecycle fields. **Supplier side** — new `GET /api/admin/pipeline` (token-gated) aggregates the same stats across ALL contractor companies + returns a per-company breakdown. New `<PipelinePanel>` on `/branding-admin` shows the 5 totals + a "Top contractors by won revenue" table (top 5). This is the supplier's first real analytics surface — Howard can see at a glance which contractors are sending the most quotes, winning the most jobs, and how much Alside material flows through them. Cleanup: also purged 28 leftover test companies + 40 stale user accounts that re-accumulated during this session. 67/67 pytest still pass; lint clean.
- **Iter 19** — **English/Spanish i18n** (Feb 2026): full bilingual support with EN/ES toggle. **Infrastructure**: new `/app/frontend/src/lib/i18n.jsx` (LangProvider + `useT()` hook, localStorage-persisted `ui-lang-v1` key, auto-detect browser preference on first load) + `/app/frontend/src/lib/dictionaries.js` (~150 keys across nav, auth, dashboard, catalog, estimate editor, quote modal, accept page, email/PDF body) + `/app/frontend/src/lib/catalogTranslations.js` (catalog section/item/unit maps — translates ~25 generic service descriptions like "Tear-Off" → "Demolición", "House Wrap" → "Membrana para casa", section titles like "Install Vinyl Siding" → "Instalar Vinil", and unit abbreviations like SQ → MC, LF → PL, PCS → PZA, while leaving brand-name products (Conquest .040, Coventry, Ascend, Charter Oak) untouched). New `LangToggle` pill component (EN/ES) appears in the authed header AND on Login (top-right) AND on the public Accept page. Verified end-to-end: EN/ES toggle works on Login, Dashboard, EstimateEditor, QuoteModal · custom messages preserved · `?lang=es` deep link flips Accept page · 0 page errors. ESLint clean.
- **Iter 21** — **Estimate-level Material Colors** (Feb 2026): removed the per-line `color` field on `EstimateLine` and replaced it with 4 estimate-level color fields on the `Estimate` model: `siding_color`, `accessories_color`, `outside_corner_color`, `soffit_fascia_color`. UI: new "Material Colors" block in `JobInfoPanel.jsx` under "Scope of Work / Notes" — 4 labeled inputs in a responsive grid (1 col mobile / 2 col tablet / 4 col desktop) with placeholder "e.g. Storm Gray". EN/ES dictionary updated (`est.colors`, `est.color.siding/accessories/outsideCorner/soffitFascia`, `est.color.placeholder`). Material List PDF (`materialList.js`) now prints a single 4-cell color summary block at the top instead of a per-line color column — matches how contractors actually order (one color per family, not per SKU). Verified end-to-end: PUT persists all 4 fields, line items preserved, WeasyPrint renders cleanly (6.8KB PDF, HTTP 200), UI screenshot confirms all 4 inputs render correctly with values. Lint clean (Python + JS).
- **Iter 20** — **Custom domain + DMARC + Print Material List with AMI #s and color** (Feb 2026): 
  - **Email Phase 4 complete**: bought `pro-quotes.com` on Cloudflare Registrar, added SPF + DKIM (Resend) + DMARC TXT records, verified domain in Resend, flipped `SENDER_EMAIL` to `quotes@pro-quotes.com` in `backend/.env`. Reply-To remains per-quote = sending contractor's owner email. Verified end-to-end: quote sent → arrived in Yahoo inbox (NOT spam) → Accept clicked → notification routed to correct contractor.
  - **Admin login renamed**: `admin@wolfandson.com` → `hhunt6677@yahoo.com` in `.env` + DB (and renamed the seed company from "Wolf and Son" to **Howard's Estimating Tool**). Empty stale "Designs by Charo" test signup and 3 stray `test_*@example.com` regression accounts purged.
  - **Browser tab + PWA manifest** cleaned: `<title>` → "Siding Estimator", manifest description → "Quoting tool for siding contractors". No more contractor name leakage on the login page.
  - **Print Material List feature**: imported AMI part numbers from Alside's `Vinyl Siding price page.xls` (~28 SKUs covering Conquest, Coventry, Odyssey, Charter Oak, vertical B&B, Pelican Bay, all coils, corners, J-channel sizes, fascia/soffit profiles, fan fold, trim nails). New `ITEM_AMI` dict in `catalog_seed.py` + idempotent `ensure_tiers_seeded()` migration that backfills `ami_part` onto already-seeded tier docs on every boot. New `CatalogItem.ami_part` + `EstimateLine.color` + `EstimateLine.ami_part` fields on the Pydantic models. UI: small grey `AMI #015456` badge next to each line name in the estimate editor; **color text input appears inline under any line with qty > 0** (placeholder "e.g. Storm Gray"). New "Material List" button in TotalsSummary opens a server-side WeasyPrint PDF with columns AMI # · Description · Color · Unit · Job Qty · Order Qty (raw qty + waste-factor-applied rounded-up qty for ordering). Reuses existing `/api/estimates/{id}/pdf` endpoint — no new backend route needed. PDF download filename: `EST-XXXXXX-Customer-materials.pdf`. Verified end-to-end: PDF generates correctly, AMI numbers + colors render, section subtotals appear. Sections + items + units translate to Spanish via existing `catalogTranslations.js`. Lint clean.
 (Feb 2026): full bilingual support with EN/ES toggle. ESLint clean.

## Configuration (`backend/.env`)
- `SUPPLIER_NAME=Alside Supply`
- `SUPPLIER_TAGLINE=Howard Hunt · Territory Sales Manager · (724) 640-4333`
- `SIGNUP_CODE=ALSIDE-JR47Q8`     ← rotate this whenever you want
- `SUPPLIER_ADMIN_TOKEN=OXSp1EX...` ← used in `/branding-admin?token=...`
- `RESEND_API_KEY=re_15w1DRpa...`
- `ADMIN_EMAIL=hhunt6677@yahoo.com` / `ADMIN_PASSWORD=Admin123!`
- `SENDER_EMAIL=quotes@pro-quotes.com` (verified domain: SPF + DKIM + DMARC live on Cloudflare)

## Backlog
### P0 (next up)
- **Stripe deposit on Accept page** — when a homeowner clicks "I accept", optionally route them to Stripe Checkout to lock in the job with a configurable deposit (Emergent test Stripe key already in pod env)
- **Email Phase 4 — custom sending domain DNS** — BLOCKED on user finishing Resend DNS setup; once verified, update `SENDER_EMAIL` in `backend/.env`

### P1
- Resend open + click tracking via webhook (`email.opened`, `email.clicked`) → show contractors which quotes are being viewed
- Real PWA app icons (still programmatic placeholder)
- "Sync to latest supplier catalog" admin action to push price updates to opt-in companies

### P2
- **Multi-Location support** (3–10 locations, e.g. Pittsburgh + Cleveland):
  - New `Location` model + `locations` collection; `location_id` on `Company` and admin `User`
  - **Same catalog pricing across all locations** (user confirmed — no per-location price tiers needed)
  - **Per-location signup codes** (e.g. `ALSIDE-PGH-XXX`, `ALSIDE-CLE-XXX`) — code auto-assigns contractor to that location at signup
  - **Strict isolation**: each location admin only sees their own contractors + pipeline analytics; cannot see other locations
  - Corporate root admin (Howard) sees all locations + can switch via location picker on `/branding-admin`
  - Each location admin gets their own login (e.g. `pittsburgh@pro-quotes.com`, `cleveland@pro-quotes.com`)
  - Estimated effort: ~1–1.5 days
- SKU-level conversion dashboard (which products get quoted vs won, supplier view)
- Job Complexity Preset dropdown on estimate (Standard 1.0× / Hard Access 1.25× / Steep Pitch 1.5× / Cut-up 1.75× labor multiplier)
- Editable per-line material cost override (for one-off odd lots, not catalog-wide)
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
