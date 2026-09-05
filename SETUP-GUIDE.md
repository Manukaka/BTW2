# Beyond Tourism World CRM — Setup Guide

Everything in the CRM works immediately on one device. The steps below switch on
team login, the public web pages, and the automation features, in the order that
makes sense. Each step is independent — stop wherever you like.

---

## 1. Hosting on your own domain (Netlify + GoDaddy) — 15 minutes, free

1. Open the claim link Claude gave you and sign in / create a free Netlify account.
   This makes the site yours and removes the password.
2. In Netlify → your site → **Domain management → Add a domain** → type your domain
   (e.g. `crm.beyondtourismworld.com` or `beyondtourismworld.com`).
3. Netlify shows you DNS records. In **GoDaddy → My Products → DNS**:
   - For a subdomain like `crm.` : add a **CNAME** record
     `Name: crm` → `Value: your-site-name.netlify.app`
   - For the bare domain: add an **A** record `Name: @` → `Value: 75.2.60.5`
     and a **CNAME** `Name: www` → `your-site-name.netlify.app`
4. Wait 10–60 minutes. Netlify issues the HTTPS certificate automatically.
5. To update the CRM later: Netlify → **Deploys → drag and drop** the folder
   containing `index.html`, the three public pages and `public-config.js`.

> Until you finish step 2 below (team login), anyone with the URL can open the CRM.
> Keep the Netlify password on, or don't enter real client data yet.

---

## 2. Team login + multi-device sync + web inquiry form (Supabase) — 20 minutes, free

1. Go to **supabase.com → New project** (free plan). Pick the Mumbai region.
2. **SQL Editor → New query**. In the CRM go to **Settings → Show setup SQL**,
   copy it, paste it into Supabase and click **Run**.
3. **Authentication → Users → Add user** for each team member (email + password).
   Turn **off** "Confirm email" under Authentication → Providers → Email if you
   don't want them to verify.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
5. In the CRM: **Settings → Team sync** → paste both → **Save & connect** → sign in.
6. Open `public-config.js` and paste the same URL and key, plus your WhatsApp number.
   Re-upload the folder to Netlify.

Now working:
- Team members sign in from any device and see the same data
- `yourdomain.com/inquiry-form.html` — share this link on WhatsApp, Instagram bio,
  Google Business. Enquiries appear under **Leads → Fetch web inquiries**
- **Publish link** on any itinerary → public proposal page + QR on flyers
- **Request feedback** on a client → public rating page; 4★+ auto-redirects to
  your Google review link (set it in Settings)

---

## 3. AI itineraries + passport/card scanning — two ways to add the key

The AI features need an API key from one provider:

- **Google Gemini (free tier):** aistudio.google.com → **Get API key** → copy the key (starts `AIza…`)
- **Anthropic Claude (pay per use, roughly ₹2–4 per itinerary):** console.anthropic.com → **API Keys** →
  create key → copy it (starts `sk-ant-…`). You will also need to add a small prepaid balance under Billing.

Then choose **A** (fastest) or **B** (best for the team). Both can be on at once — the backend is used
first when it is connected.

### Option A — paste the key in the CRM (1 minute, per device)

1. Open the CRM → **Settings → AI assistant — API key**.
2. Pick the provider, paste the key, leave *Model* blank, press **Save key**, then **Test AI**.
   It should say *Working ✓*.
3. Done — **Generate** in the itinerary builder, **Scan passport** and **Scan business card** now work.

The key is stored only in that browser (not in the code, not in GitHub, not synced to the team), so
repeat this on each computer/phone that needs AI. Use **Remove key** on a shared computer when you
are finished.

### Option B — put the key in Netlify once for everyone (10 minutes, no CLI)

Your repo already contains `netlify/functions/btw-backend.mjs` and `netlify.toml`.
Netlify deploys the function automatically with the site. The key stays on Netlify's servers —
it is never inside the web page or in GitHub.

1. Netlify → your site → **Site configuration → Environment variables → Add a variable**:
   - `GEMINI_API_KEY` = your key   (or `ANTHROPIC_API_KEY` = sk-ant-…)
   - `CRM_ACCESS_CODE` = any long random text, e.g. `btw-8k2Qz-travel-2026`
   - optional: `ANTHROPIC_MODEL` / `GEMINI_MODEL` to pick a different model (defaults:
     `claude-opus-5` / `gemini-2.0-flash`). The full list of names is in `.env.example`.
2. **Deploys → Trigger deploy → Deploy site** (env variables apply on the next deploy).
3. In the CRM → **Settings → Team backend — AI, scanning & WhatsApp**:
   - Backend URL: `https://your-domain.com/.netlify/functions/btw-backend`
   - Backend access code: the same text you set in step 1
   - **Save → Test connection** → should say *Connected ✓ — AI provider: …*

Now AI itineraries, **Scan passport** and **Scan business card** work on the live site for anyone
who enters the access code (or, with team login from section 2 switched on, for every signed-in
team member with no code at all).

**Never** paste an API key into `index.html`, `public-config.js`, `.env.example`, or chat. If a key
ever leaks, revoke it in the provider's console and create a new one.

### WhatsApp automatic sending (optional)
Meta's official Cloud API — no BSP markup. Needs a Facebook Business Manager,
business verification, and a phone number **not** already on a personal WhatsApp.

1. https://developers.facebook.com → Create app → **Business** type → add **WhatsApp**
2. Under WhatsApp → API Setup: add your business phone number and complete
   verification. Note the **Phone number ID**.
3. Create a permanent token: Business Settings → System Users → Add → assign the
   app → Generate token with `whatsapp_business_messaging` permission.
4. Add `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` to Netlify environment
   variables and trigger a deploy.
5. A **Send automatically** button now appears in every WhatsApp composer.

**Important rule from Meta:** free-form messages only deliver if the customer
messaged you in the last 24 hours. For first contact (new leads, daily programmes
sent proactively) you must use an approved **message template** — create these
under WhatsApp Manager → Message Templates. Tap-to-send has no such restriction,
which is why it remains the default.

---

## 4. Google Maps distances (optional) — 10 minutes

1. https://console.cloud.google.com → new project → **Enable APIs → Routes API**
2. Credentials → Create API key → **Restrict key** → HTTP referrers →
   add `https://yourdomain.com/*` → API restrictions → Routes API only
3. Billing must be enabled (Google gives free monthly usage per API; at your
   volume it should stay free, but set a budget alert of ₹500 to be safe).
4. Paste the key in **CRM → Settings → Google Maps API key**.
   **Auto-calc distances** appears in the itinerary builder.

---

## Files in this package

| File | Purpose |
|---|---|
| `index.html` | The CRM |
| `inquiry-form.html` | Public enquiry form (feeds Leads) |
| `view-itinerary.html` | Public proposal page (opened from share links / QR) |
| `feedback.html` | Public rating page with Google-review redirect |
| `public-config.js` | One-time config for the three public pages |
| `netlify/functions/btw-backend.mjs` | Backend (AI, OCR, WhatsApp) — deploys with the site |
| `netlify.toml` | Tells Netlify where the function lives |
| `.env.example` | Names of the backend environment variables (no values) — copy to `.env` only for local `netlify dev` |
| `supabase/functions/btw-backend/index.ts` | Same backend as a Supabase Edge Function (alternative; optional) |

Commit everything to GitHub; Netlify redeploys automatically on every push.

---

## Regular development workflow

- **GitHub is the source of truth.** Netlify rebuilds the live site within a minute
  of every push to the main branch.
- To ship an update Claude sends you: download the changed file(s), open the repo on
  github.com → click the file → **Edit (pencil)** or **Add file → Upload files** →
  drop the new version → **Commit changes**. Netlify does the rest.
- Keep `public-config.js` and your environment variables as they are — updates
  only change `index.html` and the other page files.
- Tip: enable **Deploy previews** in Netlify so pull requests get a test URL
  before going live.
