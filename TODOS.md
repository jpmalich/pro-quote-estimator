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
- [ ] **Re-evaluate the whole admin concept** — the current model is a single static
      shared secret (`SUPPLIER_ADMIN_TOKEN`) pasted into a hidden URL
      (`/branding-admin?token=…`). It's clumsy and a real breach risk: anyone who
      obtains the token has full supplier control (all tier pricing, branding, signup
      code, contractor invitations, company deletion) with no identity, no expiry, no
      revocation short of rotating the env var, and no audit trail of who did what.
      The `?token=` page unlock also still lands in browser history/bookmarks even
      though the API itself is header-only (SEC-006). Proposed direction: retire the
      shared token in favor of **role-based admin on real user accounts** — supplier
      admins log in like any user (existing JWT cookie auth + login rate limiting
      already apply), with a `supplier_admin` role gating the `/api/admin/*` routes and
      the admin UI; add an admin **audit log** (who changed which price/tier/company,
      when); optional hardening: MFA for admin accounts, short-lived break-glass token
      for emergencies only. Interim quick wins while the redesign lands:
      `hmac.compare_digest` for the token check (already in tech debt), rate-limit
      admin-token failures like login, and rotate the current production token.

## 🟠 P1 — Product (next up)

- [ ] **Multi-provider AI model support (Gemini / GPT)** — the AI Measure A/B model
      toggle merged from Howie's Emergent build (2026-07-04) originally offered Claude,
      Gemini, and GPT models through Emergent's universal-key proxy. Our decoupled
      `backend/llm.py` is Anthropic-only, so the registry (`_MODEL_CHOICES` in
      `routes/ai_measure.py`) and the frontend dropdown were trimmed to the four Claude
      models. To restore full A/B: extend `llm.py` to route per-provider (google-genai /
      openai SDKs or litellm), add `GEMINI_API_KEY`/`OPENAI_API_KEY` env vars +
      .env.example entries, and re-add the trimmed registry/dropdown/pricing rows (the
      commented markers point at this TODO). The Model Comparison panel and per-run cost
      math already work provider-agnostically.
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
- [ ] **HOVER/AI-measure imports → structured address parts** — imports already set the
      composed `address` string from the property; also populate
      `address_street/city/state/zip` (today the UI's legacy parse covers display, but
      persisting real parts is cleaner). *(Follow-up split from the auto-populate item,
      shipped 2026-07-03.)*
- [ ] **Identify and mark required fields on the input forms** — decide, per form, which
      fields are actually required vs optional, and make that visible in the UI (the
      conventional asterisk + an "* required" legend, `required`/`aria-required` on the
      inputs). Forms to cover: estimate Job Information (today nothing is hard-required;
      per the soft-required policy the likely set is customer name + job address to make
      a usable estimate, email required at send — already hinted), Login/Register
      (email, password, and signup or invite code), Team invite/rename, admin panels
      (branding, pricing uploads), and the QuoteModal (recipient email — already gates
      the Send button). Where a field is required only at a later action (email → send
      quote), mark it as such rather than blocking entry — consistent with the
      warn-don't-block policy above. Output first: a one-page field inventory
      (form × field × required/optional/required-at-send) agreed with Howard, then
      apply the markings.
- [ ] **Custom confirmation modal for destructive actions — app-wide** — design and build
      our own branded confirmation dialog instead of the browser-default `window.confirm`
      (unstylable native chrome, blocks JS, silently suppressible in some webviews, and
      looks nothing like the app). Build ONE reusable component on the already-installed
      Radix `AlertDialog` primitive (`components/ui/alert-dialog.jsx` — currently dead
      code) styled to the design system (semantic tokens, brutalist button treatment,
      danger styling for the destructive action, EN/ES labels), then support it
      THROUGHOUT the application:
      - Replace all 8 `window.confirm`/`window.alert`/`window.prompt` sites: estimate
        delete (`Dashboard.jsx:88`), catalog price reset (`Catalog.jsx:90`), waste re-bake
        (`SettingsRow.jsx:29`), unsaved-changes discards (Mezzo/Vero pricing panels ×5),
        company delete type-the-name prompt (`BrandingAdmin.jsx:779` — keep the
        type-to-confirm friction, just in our own dialog), PDF error alert
        (`QuoteModal.jsx:135` → toast).
      - Add confirmation (or undo-toast where flow speed matters) to the currently
        UNguarded one-tap destructions: photo remove, custom misc rows, Vero/Mezzo
        window openings.
      Covers and supersedes the audit item "Confirm-or-undo on one-tap destruction".
- [ ] **State dropdowns: show full state names** — the job/billing address State selects
      (`US_STATES` in `JobInfoPanel.jsx`) currently list two-letter abbreviations; show
      the full name in the option label ("Pennsylvania") while keeping the two-letter
      code as the stored value — the composed address string ("…, Pittsburgh, PA 15222"),
      CSV columns, and the legacy-address parser all expect the abbreviation. One
      name↔code map, both selects (cust-state, billing-state).

## 🟡 P2 — Product (later)

- [ ] **Redesign the /estimate page — wizard or sectioned navigation.** The editor is one
      very long scroll today; condense it into manageable grouped sections the user moves
      through. Two candidate shapes to explore (or a hybrid): a **wizard** (linear steps,
      good for new estimates / new users) vs. a **sticky section index / jump nav** (good
      for revisits and quick edits — contractors rarely fill a quote strictly in order).
      Logical groupings already present on the page, in natural workflow order:
      1. **Job Info** — customer / contact & lead / addresses / estimate meta (the four
         groups shipped 2026-07-03)
      2. **Measure** — HOVER import · AI photo measure · blueprints · pair-to-LP tiles
      3. **Pricing setup** — waste factor · sales tax · profit margin/markup · eave
         overhang · porch ceilings
      4. **Photos** — job photo gallery
      5. **Materials & colors** — Material Colors selectors (+ future swatches TODO)
      6. **Line items** — product-line tabs (Vinyl/Ascend/LP · Vero/Mezzo) with section
         accordions; windows-kind adds the opening editors — the heaviest section by far
      7. **Review & send** — totals summary · customer quote · material list · print · CSV
      Design considerations: the sticky sell-bar must stay visible in every step; autosave
      makes steps freely revisitable (no "save & continue" needed); measure imports
      (step 2) mutate line items (step 6), so the flow isn't strictly linear; mobile/field
      use favors fewer, collapsible groups over hard page breaks; a completeness indicator
      per section (like the lightbulb badges) could drive the index. Prototype both shapes
      against a real 29-window estimate before committing.
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
- [ ] **Full app redesign — modern, business-grade UI + per-company branding.** Objective:
      a modern look and feel appropriate for a professional trade tool — polished and
      business-like, not consumer-flashy. Two workstreams:
      1. **Visual redesign** — evolve the current Swiss/industrial system (or replace it
         deliberately) with modern spacing, elevation, and component polish across every
         page; fold in the open UI/UX audit items (Radix dialogs, skeletons, section
         rollups) so the redesign retires that debt rather than repainting over it.
         The audit's "bland widgets" observation from the Howie call is the origin of
         this item.
      2. **Per-company customization** — each contractor company gets its own branding
         inside the app, not just on quotes: company logo (already stored on the company
         record and shown on quotes/nav), a company brand color or full theme, and
         company-selectable defaults. Builds directly on the semantic-token theme system:
         a "company theme" is just a generated `data-theme` block (derive
         brand/brand-hover/brand-text/on-brand from one brand color, validated through
         `frontend/scripts/validate-themes.py` so contractors can't pick an inaccessible
         combo). Overlaps with theme-picker Phase 3 (supplier-pinned defaults) — design
         the precedence chain: user pick > company theme > supplier default > app default.
      Suggested path: design-system spec first (like `docs/specs/theme-picker.md`), with
      before/after mockups of Dashboard + Estimate editor for Howard's sign-off before
      any code.
- [ ] **Bring the admin pages into the theme system + modernization scope** — the six
      established themes should fully apply to `/branding-admin` and
      `/lp-formula-preview` too. The theme codemod did migrate those pages and the
      `components/admin/*` panels to semantic tokens, and the FOUC guard applies the
      persisted theme on every route — but the admin pages render OUTSIDE the app
      `Layout`, so they have **no ThemePicker in their header** (no way to switch theme
      from there), and they haven't been visually audited under all six themes
      (especially Jobsite Dark — some dark-header literals were intentionally kept).
      Work: add the ThemePicker (and LangToggle?) to the BrandingAdmin header, sweep
      both admin pages + the four pricing panels under every theme with the
      `validate-themes.py` gates in mind, and explicitly include these pages in the
      full-app modernization redesign above (same business-grade treatment — today they
      read as the least polished surfaces in the app).
- [ ] **UI theme picker — Phase 3 remainders** (Phases 0–2 shipped 2026-07-03, see
      Recently Completed): sync theme choice to the user profile so it follows login
      across devices; supplier-pinned company default theme; expand toward Howard's 8–10
      theme catalog. Spec: `docs/specs/theme-picker.md`.
      **Open questions for John/Howard:** supplier-pinned defaults (spec leans yes);
      AI purple accent constant vs per-theme (shipped constant, lightened in dark);
      supplier-flavored theme names (shipped with placeholder names).
- [ ] **3D house rendering — polish & extend** — the interactive Three.js HouseModel3D
      merged from Howie's build (2026-07-04) covers the core HOVER-style 3D ask on the
      AI Measure + Blueprint previews. Remaining: theme-token alignment of its hardcoded
      material/UI colors, exposing the model on the estimate/quote surfaces (not just
      import previews), and Howie's definition-of-done validation run (was blocked by
      his Emergent budget cap — we can run it on our Anthropic key).
- [ ] **J-block disambiguation aid** — AI can't tell light/split/UL/jumbo/dri-vent blocks
      apart; give contractors a quicker correction UI on import.
- [ ] **Quote status workflow** (draft → sent → won/lost) + duplicate-as-template.
- [ ] **Customer/contact directory + e-sign capture.** *(Partially advanced 2026-07-03:
      estimates now carry a full customer contact/company record — email, phones, fax,
      company, billing address, lead source. A cross-estimate directory view remains.)*
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
- [ ] **Confirm-or-undo on one-tap destruction** — *superseded by the P1 item "Custom
      confirmation modal for destructive actions" (2026-07-03), which carries the full
      scope; kept here for audit traceability.*
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

- [x] **Merged Howie's Emergent feature drop (iters 79j.15→.34)** — interactive 3D house
      model (AI Measure + Blueprint tabs), model A/B toggle (trimmed to Claude-only, see
      multi-provider TODO), Model Comparison panel + per-run cost, Re-run button, waste %
      baked into AI apply, photo persistence/recovery, persistent run-error banner,
      masked-vs-openings prompt overhaul, profile-annotations 404 + wizard-polygon fixes,
      4 new regression test files (24 tests, all passing) *(2026-07-04)*
- [x] **Soft input validation + format tips** — email/phone/fax/ZIP placeholders,
      warn-on-blur messages with aria-invalid/describedby, phone auto-format to
      (AAA) BBB-CCCC, invalid-email gate on quote Send *(2026-07-03)*
- [x] **Auto-populate estimate fields at creation** — Estimator = logged-in user, Date =
      today (fixed UTC→local date bug in Dashboard create), State = company's last-used
      state; fill-if-empty only *(2026-07-03)*
- [x] **Customer contact & company fields on estimates** — 10 new fields (email, cell +
      secondary phone, fax, preferred contact, company + title, billing address, lead
      source), "Contact & Lead" block in Job Info, two-way email sync with the send-quote
      dialog, quote-document + CSV integration *(2026-07-03)*

- [x] **Theme picker (Phases 0–2)** — semantic token migration (~2,100 class replacements),
      six WCAG-validated themes incl. Jobsite Dark, header + Team-page picker, FOUC guard,
      `validate-themes.py` contrast gate *(2026-07-03)*
- [x] WCAG AA accessibility pass (~410 contrast fixes) + emoji→lucide icon cleanup —
      addresses the color-blindness concern from the call *(2026-07-02)*
- [x] Decouple from Emergent: direct-Anthropic `llm.py`, Docker self-hosting stack,
      telemetry/badge removal *(2026-07-02 — do NOT replicate into Emergent)*
- [x] `PromptsForEmergent.md` replication log + maintenance rule *(2026-07-02)*
- [x] Full documentation set (`docs/`) + README *(2026-07-02)*
- [x] GitHub repo for the codebase *(2026-07-02)*
