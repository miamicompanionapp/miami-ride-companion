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

## Cost

Total monthly cost: ~$1–2 (Claude API for writing assist only)
Everything else is free.

## Attribution

Game images sourced from Wikimedia Commons under Creative Commons licenses.
See `/public/images/games/CREDITS.md` for individual attributions.

---
Built with Claude AI · May 2026
