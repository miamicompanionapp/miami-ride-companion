# Miami Ride Companion

A bilingual iPad kiosk app for rideshare drivers in Miami.
Built with Claude AI — no framework, no build step, pure HTML/CSS/JS.

## Structure

```
miami-ride-companion/
├── public/
│   ├── index.html          ← Passenger app (PWA)
│   ├── editor.html         ← Driver dashboard (password protected)
│   ├── sw.js               ← Service Worker (offline caching)
│   ├── manifest.json       ← PWA manifest
│   ├── content.json        ← All curated content (updated weekly)
│   ├── analytics.json      ← Weekly analytics data (synced from iPad)
│   ├── images/
│   │   └── games/          ← Pre-loaded landmark photos (Wikimedia Commons)
│   └── icons/              ← App icons (192x192, 512x512)
└── README.md
```

## Features

### Passenger App
- City guide with GPS-sorted venues (offline Haversine formula)
- Weather snapshot with hourly + 5-day forecast
- 5 games (fully offline)
- 4 languages: EN / ES / PT / FR (auto-translated at publish)
- QR codes per venue card
- Inactivity reset with kiosk behavior
- Abdullah's Picks — personal recommendations
- Persistent tip prompt footer

### Driver Editor
- Auto-fetch weather (Open-Meteo API)
- Auto-fetch events (Timeout Miami + Miami Eater RSS)
- Venue management with drag-to-reorder
- Claude AI writing assistant for EN+ES descriptions
- Weekly analytics dashboard
- One-click publish to GitHub → Netlify auto-deploys

## Setup

1. Fork or clone this repo
2. Connect repo to Netlify (auto-deploy on push)
3. Open `yourapp.netlify.app/editor` to configure
4. Install as PWA on iPad (Safari → Share → Add to Home Screen)
5. Enable Guided Access on iPad (Settings → Accessibility → Guided Access)

## Testing (E2E)

Tests use [Playwright](https://playwright.dev) to drive the real passenger app
and driver dashboard in a headless browser — covering every tab, all 5 games
(including scoring + answer guards), venue detail sheets, QR codes, language
switching, the rest screen (incl. auto-wake), and the PIN-gated editor. A layer
of **in-browser unit tests** also pins the pure helpers (distance, phone/vCard
formatting, date parsing, analytics roll-up, driver-translation flatten/apply),
and **`tests/backend.spec.js` unit-tests the Cloudflare Functions** (RSS/
Ticketmaster parsing + the claude-proxy origin allowlist) with no live network.
Behavioral flow tests **fail on any console or page error**, which is how we
catch silently broken functionality before it reaches the iPad. Run the suite
before every deploy.

### First-time setup

```bash
npm install                       # installs @playwright/test + wrangler
npx playwright install chromium   # one-time: download the test browser
```

### Run the tests

```bash
npm test              # run everything headless (auto-starts a local server)
npm run test:headed   # watch it run in a real browser window
npm run test:ui       # interactive Playwright UI (pick/step through tests)
npm run test:report   # open the HTML report from the last run
```

#### Scoped regressions (tags)

Tests are tagged so you can run just the area you touched instead of the whole
suite. Touched only the games? `npm run test:games`. Only the editor?
`npm run test:editor`.

```bash
npm run test:index     # whole passenger app (index.html)
npm run test:games     # all 5 games (logic + i18n + open/close flows)
npm run test:editor    # driver dashboard (editor.html)
npm run test:backend   # Cloudflare Functions pure logic (no network)
npm run test:smoke     # fast critical-path subset
npm run test:negative  # all failure-path tests
npm run test:units     # all in-browser pure-function unit tests
# also: test:weather, test:content, test:phone, test:rest, test:i18n
```

Page tags are `@index @editor @games @backend` (with sub-areas `@weather
@content @phone @rest`); cross-cutting type tags are `@unit @negative @smoke
@i18n`. Under the hood each script is `playwright test --grep <tag>`, and tags
combine — e.g. `npx playwright test --grep "@games" --grep-invert "@i18n"`.

Specs live in `tests/`. They serve `public/` through `tests/static-server.js`
(a zero-dependency Node static server — no Python or Wrangler required). The
backend specs import the `functions/api/*` helpers directly (no server needed).
To exercise the `/api` functions end-to-end instead, point the `webServer` in
`playwright.config.js` at `npx wrangler dev`.

## Cost

Total monthly cost: ~$1–2 (Claude API for writing assist only)
Everything else is free.

## Attribution

Game images sourced from Wikimedia Commons under Creative Commons licenses.
See `/public/images/games/CREDITS.md` for individual attributions.

---
Built with Claude AI · May 2026
