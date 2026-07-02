# 7. API Overview

*Part of the [Pro-Quote documentation](README.md).*

All endpoints are under `/api`. Three auth levels:

```mermaid
flowchart TD
    REQ["Incoming request to /api/*"] --> KIND{"Endpoint group"}

    KIND -- "public" --> PUB["GET /branding<br/>GET·POST /public/accept/:token<br/>POST /public/resend-webhook (Svix-verified)<br/>GET /uploads/:name<br/>POST /auth/register · /auth/login"]

    KIND -- "contractor" --> COOKIE{"Valid JWT<br/>httpOnly cookie?"}
    COOKIE -- yes --> CONTR["company · catalog · estimates CRUD +<br/>duplicate/pair · uploads · quote email + PDF ·<br/>CSV exports · Mezzo/Vero/ISS catalogs ·<br/>/measure/* (AI measure, sessions, blueprint,<br/>satellite, report PDF) · HOVER import + polling"]
    COOKIE -- no --> R401["401 Unauthorized"]

    KIND -- "supplier admin" --> TOKEN{"X-Admin-Token<br/>header valid?<br/>(never in the URL)"}
    TOKEN -- yes --> ADMIN["branding · signup code · invitations ·<br/>tier CRUD + company-tier assignment ·<br/>pricing bump/upload/export ·<br/>Mezzo/Vero/ISS price editors · pipeline stats"]
    TOKEN -- no --> R403["403 Forbidden"]
```

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

## Security posture

Hardened across a dedicated SEC-001…SEC-007 audit series:

| ID | Hardening |
|---|---|
| SEC-001 | CORS fail-closed allowlist; no wildcard with credentials |
| SEC-002 | SSRF-hardened PDF asset fetching (only `data:` and HTTPS to public IPs) |
| SEC-003 | Magic-byte upload validation |
| SEC-004 | Fail-closed secrets: boot refuses to start with a short `JWT_SECRET` or empty `ADMIN_PASSWORD` |
| SEC-005 | Login rate limiting: 5 failed attempts / IP / 15 min → 429 |
| SEC-006 | Admin token accepted in header only (URL tokens leak via logs/history) |
| SEC-007 | Strict per-user ownership of AI runs |
