# Pro-Quote Estimating Tool

A multi-tenant B2B SaaS estimating tool for exterior remodeling — vinyl/composite siding and
replacement windows. A supplier (Alside Supply) distributes it to contractor customers, who measure
houses with AI, build priced material + labor takeoffs, and email branded quotes that homeowners
can accept online.

**The pitch:** it does what a ~$150 HOVER measurement report does for **~$0.13–0.30 per AI run** —
measure a house from 8 phone photos, a HOVER PDF, architectural blueprints, or satellite imagery,
and produce the complete material list with pricing.

📖 **Full documentation:** [docs/](docs/README.md) — usage, workflows, architecture,
database, API, system requirements, and roadmap, one file per section with Mermaid diagrams.

## Features

- 📷 **AI Photo Measure** — walk the house, take up to 8 photos, give one reference dimension;
  Claude vision extracts walls, soffit, fascia, gutters, and openings
- 📄 **HOVER PDF / Blueprint import** — parse existing HOVER reports or read dimensions and window
  schedules straight off plan sheets
- 🛰️ **Satellite measure** — aerial imagery as an additional measurement source
- 🧾 **Full takeoff editor** — five product-line tabs (Vinyl, Ascend, LP SmartSide, Vero and Mezzo
  windows), per-line adders, waste/tax/margin math, "you'll probably need this" item hints
- 🪟 **Per-opening window quoting** — W×H price buckets, upgrade adders, side-by-side Vero/Mezzo
  brand comparison, bulk-apply across openings
- ✉️ **Branded quote email** with open/click/accept tracking (Resend) and a public homeowner
  accept page, in English or Spanish
- 🏢 **Multi-tenant** — supplier-controlled signup code and price tiers; each contractor company
  gets its own logo, labor rates, team invites, and estimates
- 🛠️ **Supplier admin panel** — branding, tier pricing (CSV/XLSX upload, % bump), contractor
  invitations, pipeline stats
- 📱 **Installable PWA**, mobile-first, built for phones and tablets in the field

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend | React 19 (CRA + craco), Tailwind + Radix/shadcn, react-router 7, three.js, PWA |
| Backend | FastAPI (Python 3.11), Motor/MongoDB, JWT cookie auth, WeasyPrint PDF |
| AI | Anthropic Claude vision (official `anthropic` SDK) |
| Email | Resend (+ Svix-verified webhooks) |
| Hosting | Self-hostable via Docker Compose · production at `app.pro-quotes.com` |

## Quick Start

### Docker (full stack: MongoDB + backend + frontend)

```bash
cp backend/.env.example backend/.env   # fill in JWT_SECRET, ADMIN_PASSWORD, API keys…
docker compose up --build             # frontend on :3000, API on :8000
```

### Manual

```bash
# Backend — requires MongoDB and a backend/.env (see docs/08-system-requirements.md);
# the server fails closed without JWT_SECRET, ADMIN_PASSWORD, MONGO_URL, DB_NAME, CORS_ORIGINS
cd backend
pip install -r requirements.txt
uvicorn server:app --reload        # http://localhost:8000

# Frontend
cd frontend
yarn install
echo "REACT_APP_BACKEND_URL=http://localhost:8000" > .env
yarn start                         # http://localhost:3000
```

### Lint & test

```bash
cd backend && ruff check . && pytest tests/   # integration tests hit a live deployment;
                                              # they skip cleanly without SIGNUP_CODE/TEST_* env
cd frontend && npx eslint src
```

See [CODE_QUALITY.md](CODE_QUALITY.md) for the lint philosophy before flagging anything.

## Repository Layout

```
backend/         FastAPI app — routes/, pricing engine (services.py), seeders, tests/
frontend/        React SPA — pages/, components/, domain logic in src/lib/
memory/          PRD.md (full product history) · REMINDERS.md (backlog)
Resource_Docs/   Recorded conversation with the creator + transcript
docs/            Full application documentation (one file per section)
CLAUDE.md        Guidance for AI coding agents
```
