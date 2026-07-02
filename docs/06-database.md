# 6. Database

*Part of the [Pro-Quote documentation](README.md).*

MongoDB (async via Motor). Connection from `MONGO_URL` / `DB_NAME`.

## Entity relationships

```mermaid
erDiagram
    PRICE_TIERS ||--o{ COMPANIES : "assigned to"
    COMPANIES ||--o{ USERS : "has members"
    COMPANIES ||--o| CATALOGS : "labor override deltas"
    COMPANIES ||--o{ ESTIMATES : "owns"
    ESTIMATES |o--o| ESTIMATES : "paired windows / LP estimate"
    ESTIMATES ||--o| AI_MEASURE_SESSIONS : "in-progress measure"
    ESTIMATES ||--o{ AI_MEASURE_RUNS : "photo-measure runs (TTL 24h)"
    ESTIMATES ||--o{ AI_BLUEPRINT_RUNS : "blueprint runs (TTL 24h)"
    ESTIMATES ||--o{ HOVER_IMPORT_RUNS : "HOVER imports (TTL 24h)"
    PRICE_TIERS ||--o{ MEZZO_PRICES : "per tier x product"
    PRICE_TIERS ||--o{ VERO_PRICES : "per tier x product"

    PRICE_TIERS {
        string id PK
        string name "one-opp / Builder-Dealer / Contractor / wholesale"
        array sections "full catalog: mat, lab, SKU per item"
    }
    COMPANIES {
        string id PK
        string name
        string owner_user_id FK
        string invite_code "8-char team join code"
        string logo_url
        string price_tier_id FK
        bool quote_footer_enabled
    }
    USERS {
        string id PK
        string email UK
        string password_hash "bcrypt"
        string role
        string company_id FK
    }
    CATALOGS {
        string company_id FK
        object overrides "section::name to lab delta"
    }
    ESTIMATES {
        string id PK
        string company_id FK
        string kind "siding / windows / lp_smart / iss"
        array lines "per-tab qty x mat x lab + adders"
        array mezzo_openings "WxH price buckets"
        array vero_openings "WxH price buckets"
        string paired_estimate_id FK
        string paired_lp_estimate_id FK
        object hover_measurements
        array tracking "sent/opened/clicked events"
        object accept "acceptance record"
    }
    MEZZO_PRICES {
        string tier
        string product_type
        object base_prices "per size bucket"
        object adder_prices
    }
    VERO_PRICES {
        string tier
        string product_type
        object base_prices
        object adder_prices
    }
```

Standalone collections (no cross-references): `settings` (singleton supplier-branding document),
`invitations` (contractor invites sent from the admin panel), `iss_catalog` (single-tier ISS price
book), `upload_blobs` (byte-level mirror of uploaded files for disk-loss recovery), and
`hover_page_cache` (rendered PDF page images for Deep Verify, TTL 1 h).

## Collection reference

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
> customer quote is currently unrecoverable). See [Known Gaps & Roadmap](10-known-gaps-roadmap.md).
