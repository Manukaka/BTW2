# Beyond Tourism World — Travel Ops CRM

Internal CRM for Beyond Tourism World (Maharashtra outbound tour operator, CEO Gautam Pawar).
Built for a ~5-person team; Manoj (digital marketing volunteer) is the product owner and is
**not a developer** — explain changes in plain language, ship working files, keep things simple.

## What this is

A single-file web app (`index.html`, ~3,000 lines, vanilla JS + Tailwind CDN + Chart.js + qrcodejs +
supabase-js UMD). No build step. Hosted on Netlify, source on GitHub, auto-deploys on push to main.
Feature set mirrors TripDesq-style travel CRMs: leads pipeline, AI itineraries, bookings, GST
invoicing, visa tracking, corporate accounts, vendors, feedback, WhatsApp tap-to-send everywhere.

## Files

| File | Role |
|---|---|
| `index.html` | The whole CRM. Everything lives here. |
| `inquiry-form.html` | Public enquiry form → Supabase `inquiries` table |
| `view-itinerary.html` | Public proposal page, reads `shared_itineraries` by `?t=token` |
| `feedback.html` | Public star rating → `feedback_public`; 4★+ redirects to Google review URL |
| `public-config.js` | Supabase URL/anon key + agency name/phone for the three public pages |
| `netlify/functions/btw-backend.mjs` | Backend: AI itinerary, passport/card OCR, WhatsApp Cloud API send. Keys via Netlify env vars. |
| `netlify.toml` | publish `.`, functions dir |
| `.env.example` | Names of backend env vars, no values. `.env` is git-ignored. |
| `supabase/functions/btw-backend/index.ts` | Same backend as a Supabase Edge Function (alternative, optional) |
| `SETUP-GUIDE.md` | Human setup steps (domain, Supabase, keys). Keep it in sync with code changes. |

## Architecture of index.html (read this before editing)

- **State:** one global `STATE` object (`settings, leads, itineraries, bookings, invoices, payments,
  tasks, vendors, visaCases, companies, feedback, counters`). Mutate it, then `saveState()`, then `render()`.
- **Persistence:** `persistGet/persistSet` → `window.storage` inside Claude artifacts, else `localStorage`
  (`btw_crm_state_v2`). When Supabase is connected and signed in (`SYNC==='online'`), `saveState()`
  also upserts the whole state as JSON into `crm_state` row id=1 (debounced). Integration keys live in
  `CONFIG` (`btw_crm_config_v2`), per device, never synced — includes the optional device-local AI key
  (`aiProvider | aiApiKey | aiModel`).
- **Backfill:** `backfillState()` adds new fields to old saved data. Add a line there whenever you add a
  field to a record type.
- **Routing:** hash-based. `VIEWS[name](id)` returns an HTML string. `navigate(view, id)`.
- **Events:** single delegated `handleClick` on `document.body` keyed by `data-action` (+ `handleChange`
  for `itin-field`, `day-field`, `itin-list`, `lead-owner-filter`). Add a `case` for every new
  `data-action`. Modal-local buttons (delete etc.) get direct listeners inside the modal's `onMount`.
- **UI helpers:** `openModal`, `openFormModal({fields, onSubmit})` (field spec → form), `confirmDialog`,
  `renderTable`, `renderKanban` + `wireKanbanDnD`, `kpiCard`, `toast`, `printHTML(html)` (fills
  `#print-area`, calls `window.print()`).
- **Documents** are inline-styled HTML strings: `printItinerary`, `printPhotoItinerary`, `printComparison`,
  `printVoucher`, `printInvoice`, `printReceipt`, `makeFlyer` (QR via `qrDataUrl`). Header/signature via
  `docHeader()` / `agencySignature()`.
- **WhatsApp:** `waLink/openWhatsApp` build `wa.me` links (free, user taps send). `quickWaModal` is the
  generic composer; a **Send automatically** button appears when `backendReady()`.
- **Backend calls:** `callBackend(task, payload)` → `CONFIG.backendUrl` with Bearer = Supabase session
  token or `CONFIG.backendCode`. Tasks: `ai_itinerary | ocr_passport | ocr_card | whatsapp_send | ping`.
- **AI calls:** always go through `aiText(system, prompt)` / `aiOcr(task, file)`. Route order: backend
  (`backendReady()`) → key saved on this device (`aiDirectReady()`, Settings → AI assistant; Anthropic
  needs the `anthropic-dangerous-direct-browser-access` header, Gemini uses `x-goog-api-key`) → Claude
  artifact (key injected). `aiReady()` gates the Generate / Scan buttons. Default models in
  `AI_DEFAULT_MODEL` (`claude-opus-5`, `gemini-2.0-flash`); backend reads `ANTHROPIC_MODEL` / `GEMINI_MODEL`.
  Free fallback = Copy prompt / Paste AI reply.
- **Photos:** `wikiImage()` queries Wikipedia page images (no key); `fetchPhotos()` fills cover + day photos.
- **Design:** navy `#12303D`, teal `#1F7A6C`, gold `#C98A3D`; Fraunces (display) / Public Sans (body) /
  JetBrains Mono (labels, money). Ticket/boarding-pass motif (`.ticket`, `.stub-divider`), departure-board
  nav (`.gate-badge`). Keep this look — don't introduce generic purple-gradient UI.

## Hard rules

- **Never put API keys in any HTML/JS file or commit them.** Keys go in Netlify env vars
  (`ANTHROPIC_API_KEY` or `GEMINI_API_KEY`, optional `ANTHROPIC_MODEL`/`GEMINI_MODEL`, `CRM_ACCESS_CODE`,
  `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) — or, for one device only, in the Settings → AI assistant
  form, which stores them in `CONFIG` (browser storage). Never in `public-config.js` or `.env.example`.
- Don't use `localStorage` directly — go through `persistGet/persistSet`.
- Escape all user data in templates with `esc()`.
- Internal notes to the team may be Marathi; anything client-facing (documents, public pages) is English.
- Indian conventions: ₹ with `en-IN` grouping, GST 5% packages / 18% services, dates `DD MMM YYYY`.

## Testing

Playwright is the harness. After any change:
```
node --check <(sed -n "/<script>/,/<\/script>/p" index.html | sed '1d;$d')   # or extract the script block
```
then load `index.html` in headless Chromium (see the `test*.js` pattern: navigate every `VIEWS` key,
exercise a create flow in each module, reload to verify persistence, capture `pageerror`/console errors).
A change is done when all views render with zero errors and the print documents still lay out correctly.

## Roadmap / open items

- Verify Supabase flows end-to-end once the owner shares a project (auth, `crm_state` sync, `inquiries`,
  `shared_itineraries`, `feedback_public`) — code is written but untested against a live DB.
- Verify backend tasks against real keys (AI, OCR, WhatsApp). WhatsApp free-form send only works in the
  24-hour window; templates needed for first contact.
- Nice-to-haves not built: per-user roles/permissions, hotel-level costing table per itinerary,
  multi-currency, Google Maps embedded map (only links + Routes API distances exist).
- The existing Thailand costing Excel workbook (separate project) could feed itinerary cost prices.
