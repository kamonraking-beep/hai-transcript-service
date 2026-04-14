# Honorable AI — Phase 6

Debate Judge + Debunk Engine. Multi-provider AI. Three-tier monetization. Android-ready.

---

## What's new in Phase 6

### ✅ Transcript fetching that actually works
The root cause of the CORS failure is that YouTube blocks browser-based requests from arbitrary domains. The fix is a tiny backend service you deploy once.

**Deploy the transcript service in `/server/`** — it uses YouTube's Innertube API, impersonating an Android client, which is the most reliable method in 2025. The service runs on any non-cloud-provider server (Railway.app free tier deploys in 2 minutes).

**Strategy cascade:**
1. Your deployed transcript service (Innertube Android client — works for auto-captions on any public video)
2. Innertube Web client fallback
3. Direct timedtext API fallback
4. Browser-side CORS proxy cascade (corsproxy.io → cors.sh → thingproxy)
5. Manual paste

**Critical deployment note:** Do NOT deploy on AWS, Google Cloud, Azure, or DigitalOcean. YouTube specifically blocks IP ranges from cloud providers. Use Railway.app, Render.com, Fly.io, or any residential/non-cloud VPS.

### 💳 Three-tier Stripe monetization
Three products in the Debunk Engine:

| Tier | Price | Content |
|---|---|---|
| 🆓 Free | $0 | Claims map + summary + 5 rebuttal lines |
| ⭐ Standard | $5 | Full report + framing + op-ed + HTML/TXT/JSON exports |
| 💎 Premium | $10 | Everything + visual charts + verdict breakdown + citations + blog HTML |

Setup: create 3 products in Stripe Dashboard → add Price IDs to server/.env → add publishable key to Settings.

### 📊 Premium visual charts
The Premium tier generates inline charts directly in the report:
- Claims verdict breakdown bar chart (Misleading / Partially True / Supported)
- Rhetorical devices grid
- Sentiment analysis breakdown

### 📱 Android WebView wrapper
See `/android/` — a complete Java WebView activity that:
- Loads your web app in a fullscreen WebView
- Opens Stripe checkout in Chrome (required for 3DS/Apple Pay/Google Pay)
- Bridges share sheet, toasts, and platform detection to JavaScript
- Handles back button navigation

---

## Transcript Service — Quick Deploy

```bash
cd server/
npm install

# Set your domain in src/transcript.js (allowed origins array)
# Then deploy:

# Option A — Railway (recommended, free tier)
npm install -g @railway/cli
railway login
railway init
railway up

# Option B — Render.com
# Create new Web Service → connect repo → set start command: node src/transcript.js

# Option C — Docker
docker build -t hai-transcript .
docker run -p 4000:4000 hai-transcript
```

After deployment, paste the URL (e.g. `https://your-service.railway.app`) into Settings → Transcript Service URL, then click "Test Connection".

---

## Stripe Setup (5 minutes)

1. Go to https://dashboard.stripe.com/products
2. Create three products:
   - **Debunk Basic** — $1.00 one-time
   - **Debunk Standard** — $5.00 one-time
   - **Debunk Premium** — $10.00 one-time
3. Copy each Price ID (starts with `price_`)
4. In `/server/.env`:
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ID_BASIC=price_...
STRIPE_PRICE_ID_STANDARD=price_...
STRIPE_PRICE_ID_PREMIUM=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
BASE_URL=https://your-domain.com
```
5. In the app Settings → paste your Stripe Publishable Key (`pk_live_...`)

---

## Android App Setup

The `/android/` folder is a standard Android project. Open in Android Studio:
1. Change `APP_URL` in `MainActivity.java` to your production URL
2. Add your app icon to `res/mipmap/`
3. Build → Generate Signed APK
4. Submit to Google Play Store

**Stripe on Android:** The wrapper opens Stripe Checkout in Chrome using an Intent. This is the correct approach — Stripe Checkout does not work reliably inside Android WebView due to popup requirements for 3DS and Google Pay. Opening Chrome handles all of this correctly.

---

## Monetization math

| Tier | Retail | AI Cost (Claude Sonnet) | Margin |
|---|---|---|---|
| Free | $0 | ~$0.03 | You absorb (acquisition) |
| Standard | $5 | ~$0.06 | **~98.7%** |
| Premium | $10 | ~$0.10 | **~99%** |

DeepSeek reduces AI cost to ~$0.004/report — margin becomes essentially 100%.

---

## Phase roadmap

| Phase | Feature | Status |
|---|---|---|
| 3 | Debate judge engine + exports | ✅ |
| 4 | Debunk Engine + counter-claim | ✅ |
| 5 | Multi-provider AI (Claude/GPT/DeepSeek/Grok) | ✅ |
| 5b | CORS fixes + favicon + proxy cascade | ✅ |
| 6 | **Innertube transcript server + Stripe + Android + Tiers** | ✅ |
| 7 | Membership site (Honorable AI Judge) + user accounts | Planned |
| 8 | PDF export (Playwright) + Postgres + Redis queue | Planned |
| 9 | MCP server + SMM Jacai bridge | Planned |
