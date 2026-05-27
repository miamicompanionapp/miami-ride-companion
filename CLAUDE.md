# Miami Ride Companion

A PWA tablet app Abdullah runs in his car for Lyft/Uber passengers. Passengers see a city guide, live weather, and games. Abdullah manages content via a PIN-protected driver dashboard.

## Project Structure
```
public/
  index.html      — Passenger-facing PWA (City Guide, Weather, Games)
  editor.html     — Driver Dashboard (PIN-protected, edit venues/events/handyman ad)
  sw.js           — Service Worker (cache version miami-ride-v1.4.0, full offline)
  content.json    — Single data file (venues, events, weather, handyman ad, UI strings)
  manifest.json   — PWA manifest
  images/games/   — Landmark images for Guess the Image game
netlify.toml      — Netlify config
```

## Deployment
- Hosted on **Netlify** (static, auto-deploys on git push)
- Publishing flow: Driver Dashboard → commits `public/content.json` via GitHub API → Netlify redeploys (~30s)
- Netlify Function: `/.netlify/functions/claude-proxy` — proxies Claude API calls for auto-translation (key set as `ANTHROPIC_API_KEY` env var in Netlify)

## Content (`content.json`)
- **8 venues**: Versailles Restaurant, Kyu Miami, Mandolin Aegean Bistro, Gramps (sponsored), Wynwood Walls, South Beach/Ocean Drive, El Mago de las Fritas, The Underline
- **3 events**: Wynwood Music Series, Viernes Culturales, Art Deco Weekend
- **Handyman ad**: Abdullah's handyman service, phone `(786) 919-2115`
- **Languages**: EN / ES / PT / FR (all venue descriptions, events, and UI strings translated)

## Design System
- Colors: `--navy #0F2137`, `--teal #0B9EA6`, `--gold #C9A84C`
- Fonts: DM Sans (body) + Playfair Display (display/headings)
- Icons: Tabler Icons webfont `@tabler/icons-webfont@2.47.0`

## Key Details
- Dashboard default PIN: `1234` (user-changeable in Settings panel)
- GitHub settings (token, owner, repo, branch) stored in `localStorage` in the browser
- GPS used to sort venues by distance from current location
- Inactivity timer: 60s → 15s countdown → thanks screen → auto-reset
- Abdullah is from Turkey; Mandolin Aegean Bistro is his top personal pick
