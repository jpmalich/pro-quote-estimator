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

## 🔍 UI/UX audit findings (2026-07-02)

From a three-part audit (baseline-ui, accessibility, motion/performance + field-use UX)
plus a live visual review. Contrast/color items are excluded (fixed earlier that day).

### High impact

- [ ] **Adopt the existing Radix Dialog/AlertDialog for the ~22 hand-rolled modals** —
      `components/ui/dialog.jsx` exists but every product modal is a raw `fixed inset-0`
      div: no Escape-to-close, no focus trap/restore, no `role="dialog"`. Start with the
      simple ones (`TabPickerModal`, `BulkApplyConfirm`, `ElevationCompareModal`); for the
      giant canvas modals at minimum add role/aria-modal/Escape/initial-focus.
- [ ] **Dashboard estimate rows are click-only divs** — the app's primary navigation is
      keyboard-unreachable (`Dashboard.jsx:337`). Make the row a real `<Link>` or add
      `role`/`tabIndex`/Enter.
- [ ] **Name the estimate-grid inputs** — qty/mat/lab inputs (dozens per estimate) have no
      accessible name at any breakpoint (`SectionAccordion.jsx:244–315`); add per-input
      `aria-label` (item name + column). Same for the app-wide `.label` pattern — only one
      `htmlFor` exists in the entire app (Login, JobInfoPanel color selects, admin panels).
- [ ] **Surface autosave failures** — autosave errors only `console.warn`
      (`useEstimate.js:481`); a contractor in a dead zone can silently lose 30 min of
      edits. Add a persistent saved/saving/error chip near the StickyBar, retry with
      backoff, and a localStorage snapshot + "Restore unsaved changes?" on load.
- [ ] **Offline resilience** — no `navigator.onLine` handling, no axios timeout (a hung
      PUT blocks all future autosaves via `savingRef`), and the service worker only
      pre-caches `/` (can white-screen after deploys: stale index.html → deleted hashed
      bundles). Fix: 15s axios timeout, offline banner, network-first navigations +
      runtime caching of `/static/*`, cache-bust per release.
- [ ] **Confirm-or-undo on one-tap destruction** — photo remove (`PhotosPanel.jsx:55`),
      custom misc rows (`SectionAccordion.jsx:574`), and fully-configured Vero/Mezzo
      window openings all delete on a single (gloved) tap with no undo. Also replace the
      8 `window.confirm`/`alert` call sites with the AlertDialog primitive.
- [ ] **Code-split the bundle** — zero `React.lazy` anywhere; login-only users download the
      entire 17k-line estimate-editor tree (AIMeasureButton alone is 3k lines). Lazy-load
      routes in `App.js` and the measure/annotate modals at their trigger buttons.

### Medium impact

- [ ] **`h-screen` → `h-dvh`** (16 occurrences) and **PWA safe-area support** — add
      `viewport-fit=cover` to the viewport meta (without it the one existing
      `env(safe-area-inset-*)` is a no-op) + safe-area padding on `.sell-bar`/header for
      notched iPhones in standalone mode.
- [ ] **Estimate-editor render performance** — every keystroke maps the full merged lines
      array and re-renders all unmemoized accordions (`useEstimate.js:159`,
      `EstimateEditor.jsx:101,187`); memoize `SectionAccordion`, hoist `onToggle`, memo
      `linesBySection`. Also: Catalog deep-clones the whole catalog per keystroke
      (`Catalog.jsx:47` `JSON.parse(JSON.stringify)`), Dashboard recomputes row totals per
      render, `ProfileAnnotator` zoom animates `width` (use transform like
      `PhotoAnnotateModal`), pinch/pan sets React state per pointermove, `QuoteModal` puts
      `backdrop-blur` on the full scrolling viewport.
- [ ] **Icon-only buttons without accessible names** (~13: modal closes, annotation
      Trash2s) + reset buttons named only "↺" + placeholder-only inputs (Team rename,
      Dashboard search, QuoteModal email).
- [ ] **Double-submit guards** — TotalsSummary's Quote/Materials/Print/CSV buttons don't
      disable during their multi-second async handlers.
- [ ] **Sub-44px touch targets** — photo-remove X (~22px), mat/lab reset ↺ (20px), adder
      qty input (28px), "Switch workspace" text button.
- [ ] **Form errors not announced** — Login error div needs `role="alert"` +
      `aria-invalid`/`aria-describedby`; AI-run stage progress needs `role="status"`
      `aria-live="polite"`; several flows are toast-only (ISS autosave, Team,
      BrandingAdmin) and need inline error text near the action.
- [ ] **Semantics** — estimate grid/Catalog/Dashboard column headers are divs (no
      table/grid roles); `EstimateEditor` renders zero headings; accordions missing
      `aria-expanded`; EN/ES + create/join toggles missing `aria-pressed`.
- [ ] **z-index scale** — ad-hoc z-40/50/[60]/[70]/[100] literals exist only to outbid each
      other; define theme tokens (header/sticky/modal/stacked/toast).
- [ ] **Purple AI-feature styling** — gradients (`from-[#7C3AED] to-[#A855F7]` etc.) and a
      second accent color clash with the flat black/orange system; decide the policy
      (solid purple as a sanctioned "AI" accent, or restyle to brand).
- [ ] **AI-run progress is lost on SPA navigation** — polling lives in the modal; add a
      persistent "AI measure running…" pill (StickyBar) keyed off the run id.

### Low impact / cleanup

- [ ] Skeleton loading states (`ui/skeleton.jsx` exists, unused) instead of bare spinners.
- [ ] Dead-weight cleanup: `recharts` (zero imports), ~30 unused shadcn `ui/*` components,
      the dead shadcn toast stack (sonner is the live system), `Elevation3DPreview`/three.js
      (currently unreferenced — delete or lazy-load when it returns).
- [ ] Bilingual gaps: hardcoded-English `aria-label`s, `printTakeoff.js` hardcodes
      `lang="en"` (materialList/emailQuote do it right); AI Measure modal untranslated.
- [ ] Skip-to-content link; `cn()` adoption for the 137 template-literal classNames;
      `w-N h-N` → `size-N`; `text-balance`/`text-pretty` on headings/paragraphs.
- [ ] Small fixes: `Object.assign(est, data)` state mutation after quote send
      (`EstimateEditor.jsx:428`), navigation-during-render on load failure
      (`EstimateEditor.jsx:149`), Dashboard delete lacks try/catch, `window.alert` for PDF
      errors, persistent `will-change` on the photo pan layer, Login hero image not
      full-bleed (white letterboxing on the right pane).

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
