# Reminders & Deferred Suggestions

> **Main agent: read this file at the start of every session and surface these to the user when relevant.**

## ✅ Completed this session
- Per-customer labor overrides on every line item (with orange highlight + ↺ reset button when overridden)
- Default catalog reverted to Wolf and Son sheet (material + reasonable labor defaults baked in)

## Pending from previous session(s)

### From iteration-5 wrap-up (Alside Supply pivot)
1. **Upload Alside Supply logo** — visit the branding-admin URL with the supplier admin token; the placeholder "A" tile still shows on the login page until real logo is uploaded.
2. **Rotate `SIGNUP_CODE`** in `backend/.env` after the initial rollout so the code shared in early sales emails can't be guessed by anyone later.
3. **Real PWA app icons** — `/app/frontend/public/icons/icon-192.png` and `icon-512.png` are programmatically-generated placeholders (black square with orange band). Designed icons would look much better when contractors install the PWA to their home screen.

### From code-review session
4. **Server-side PDF rendering** of the customer quote — current "Print" relies on each browser's print dialog so PDFs can look slightly different. A server-side render (WeasyPrint or Playwright) would give pixel-perfect identical PDFs every time.
5. **Product-level conversion dashboard at `/branding-admin`** — every saved estimate stores which Alside SKUs were quoted. A new screen could show *"Last 30 days: $284k of Conquest quoted by 12 contractors, $19k closed"* — high-value for Alside sales to identify which contractors are quoting but not ordering specific products.
6. **"Sync to latest supplier catalog" admin action** — when Alside updates `catalog_seed.py` prices, existing contractor companies keep their old custom catalog (intentional). Add an opt-in "Refresh from supplier defaults" button so contractors can sync to the latest wholesale prices when Alside ships an update.

### Lower-priority backlog (from PRD.md)
- Role-based catalog editing (owner-only)
- Customer / contact directory + e-sign capture on quote
- Quote status workflow (draft → sent → won/lost) + duplicate-as-template
- Lead-source field + "$ profit closed by channel" contractor analytics
- Cloudinary photo CDN
- Stripe billing if Alside ever monetizes the tool
- Reject unsupported MIME on logo uploads with 415 instead of silently coercing
- `hmac.compare_digest` for admin token check
- Migrate deprecated `@app.on_event` → FastAPI lifespan

### Security follow-up
7. **Rotate the Anthropic Claude API key** that was pasted twice in chat during the Resend setup (`sk-ant-api03-jeoC3j6w...`) — it has been exposed and should be revoked at https://console.anthropic.com/settings/keys

---

## How to use this file
- Main agent: Surface these to the user at the start of each new session in a short, friendly way (don't dump the whole list — pick 1-2 most relevant).
- When an item gets done, move it to the "Completed" section in `PRD.md` with the date.
- When the user defers something, add it here with date.

## Last updated
2026-05-23
