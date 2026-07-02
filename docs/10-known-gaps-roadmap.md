# 10. Known Gaps, Risks & Roadmap

*Part of the [Pro-Quote documentation](README.md). From the recorded conversation and the
project's own backlog (`memory/REMINDERS.md`, PRD backlog).*

## Operational risks (raised in the conversation)

- **No MongoDB backup/restore plan** — a deleted or corrupted quote is unrecoverable today.
- **Accessibility** — no color-blind-safe palette or accessibility audit; noted as a hard
  requirement for any government-adjacent adoption (Section 508-type review would fail today).
- **Secrets hygiene** — an Anthropic API key was exposed in a chat session and should be rotated;
  the signup code should be rotated whenever distribution changes; test-era admin credentials
  appear in historical docs.

## Product gaps acknowledged by the creator

- No HOVER-style polished 3D rendering of the house (the AI cannot yet draw it reliably).
- AI cannot distinguish J-block variants (light/split/UL/jumbo/dri-vent) — contractors adjust
  these lines manually.
- Pricing updates still driven by a multi-tab Excel workflow the creator finds clunky.
- No per-section rollup totals in the editor (deemed low-priority — "most guys just care about the
  final number").
- UI theming — a future "pick your look & feel" settings panel was suggested.

## Backlog highlights (PRD / REMINDERS)

- Stripe deposit on the accept page (P0)
- Real PWA app icons (currently programmatic placeholders)
- Server-side pixel-perfect PDF for all browsers
- Supplier conversion dashboard (quoted vs ordered $ per SKU across contractors)
- "Sync all contractors to latest tier prices" bulk admin action
- Quote status workflow (draft → sent → won/lost), customer directory, e-sign capture
- Possible product split: separate siding and windows apps
