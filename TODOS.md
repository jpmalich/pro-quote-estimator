# TODOS

Consolidated working TODO list for Pro-Quote. Sources: `memory/REMINDERS.md`, the PRD
backlog (`memory/PRD.md`), the recorded conversation with Howie
(`Resource_Docs/ConversationWithHowie-transcript.txt`), and session work.

Check items off as they land; move finished items to **Recently Completed** with a date.
App-affecting items also need a `PromptsForEmergent.md` entry when completed (see CLAUDE.md).

## 🔴 P0 — Operational & security (do first)

- [ ] **MongoDB backup/restore strategy** — no backups exist today; a deleted or corrupted
      quote is unrecoverable. Add scheduled `mongodump` (or Atlas backups when hosted there)
      + a documented restore drill. *(Top risk raised in the Howie call.)*
- [ ] **Rotate the exposed Anthropic API key** — a key was pasted in a chat session
      (noted in `memory/REMINDERS.md`); rotate at console.anthropic.com.
- [ ] **Rotate `SIGNUP_CODE`** in the production env now that it's been handed out
      (it also appears in the PRD and call recording).
- [ ] **Smoke-test one real AI run against the direct Anthropic client** (`backend/llm.py`)
      with a funded `ANTHROPIC_API_KEY` — one HOVER import or photo measure end-to-end.
      *(Only untested piece of the decoupling.)*
- [ ] **Decide production hosting for the self-hosted stack** (docker-compose is ready:
      Mongo + API + SPA) and set real secrets in `backend/.env`.

## 🟠 P1 — Product (next up)

- [ ] **Stripe deposit on the Accept page** — homeowner clicks "I accept" → optional
      Stripe Checkout for a configurable deposit. *(PRD P0-next-up.)*
- [ ] **Real PWA app icons** — currently programmatic placeholders.
- [ ] **Upload the real Alside Supply logo** via `/branding-admin` (login page still shows
      the placeholder monogram).
- [ ] **Supplier conversion dashboard** at `/branding-admin` — $ quoted vs ordered per SKU
      across all contractors. *(Big sales lever for Alside.)*
- [ ] **"Sync all contractors to latest tier prices" bulk admin action** — one-click push
      when Alside updates wholesale pricing.
- [ ] **Easier pricing updates** — Howard maintains an 8-tab Excel sheet; streamline the
      upload flow around it. *(Pain point from the call.)*

## 🟡 P2 — Product (later)

- [ ] **Material Colors section: show the actual colors** — on the estimate page, enhance
      the "Material Colors" section by rendering real color swatches for the selected
      products (e.g. manufacturer siding/trim color chips next to each picker) instead of
      text-only selection. Explore `lib/colorOptions.js` as the source for swatch values.
- [ ] **Material Colors: option-list management strategy** — today the option lists in the
      "Material Colors" section are hardcoded in the frontend (`lib/colorOptions.js`), so
      adding/renaming/retiring a manufacturer color means a code change. Design a strategy
      for updating/modifying the options in ALL of the section's lists — e.g. move them to
      a backend-served catalog (per product line, per supplier) editable from the admin
      panel, with versioning so existing estimates keep the color names they were quoted
      with. Pairs with the swatch item above.
- [ ] **UI theme picker** — user-selectable look-and-feel presets (suggested in the call).
- [ ] **HOVER-style 3D house rendering** from measurements — the missing piece vs HOVER;
      `elevation3D.js`/three.js groundwork exists.
- [ ] **J-block disambiguation aid** — AI can't tell light/split/UL/jumbo/dri-vent blocks
      apart; give contractors a quicker correction UI on import.
- [ ] **Quote status workflow** (draft → sent → won/lost) + duplicate-as-template.
- [ ] **Customer/contact directory + e-sign capture.**
- [ ] **Lead-source field + "$ closed by channel" contractor analytics.**
- [ ] **Role-based catalog editing** (owner-only).
- [ ] **Job complexity presets** — Standard / Second Story / Hard Access / Steep Pitch
      one-click labor multipliers.
- [ ] **Server-side pixel-perfect quote PDF** for all browsers (WeasyPrint groundwork exists).
- [ ] **Cloudinary (or similar) photo CDN.**
- [ ] **Per-section rollup totals** in the estimate editor. *(Howie: low value — "most guys
      just care about the final number".)*

## 🔧 Tech debt

- [ ] Reject unsupported upload MIME types with 415 instead of silently coercing.
- [ ] Use `hmac.compare_digest` for the admin-token check.
- [ ] Migrate deprecated `@app.on_event` startup/shutdown → FastAPI lifespan handlers.
- [ ] Update the pytest suite for the tier-aware catalog endpoint shape.
- [ ] Redundant hover states left by the contrast pass (base color now equals hover on a
      few links, e.g. `BlueprintMeasureButton` dismiss, `PhotoAnnotateModal`) — pick new
      hover targets.
- [ ] White numerals on the orange `CoverageBar` segment in `TakeoffReconCard` (inline
      style fill, missed by the class-based contrast sweep).

## ✅ Recently completed

- [x] WCAG AA accessibility pass (~410 contrast fixes) + emoji→lucide icon cleanup —
      addresses the color-blindness concern from the call *(2026-07-02)*
- [x] Decouple from Emergent: direct-Anthropic `llm.py`, Docker self-hosting stack,
      telemetry/badge removal *(2026-07-02 — do NOT replicate into Emergent)*
- [x] `PromptsForEmergent.md` replication log + maintenance rule *(2026-07-02)*
- [x] Full documentation set (`docs/`) + README *(2026-07-02)*
- [x] GitHub repo for the codebase *(2026-07-02)*
