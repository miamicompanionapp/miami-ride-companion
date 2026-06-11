# Miami Ride Companion

A PWA tablet app Abdullah runs in his car for Lyft/Uber passengers. Passengers see a city guide, live weather, and games. Abdullah manages content via a PIN-protected driver dashboard.

## Project Structure
```
public/
  index.html      — Passenger-facing PWA (~3200 lines, CSS+JS monolith)
  editor.html     — Driver Dashboard (PIN-protected, ~1500 lines)
  sw.js           — Service Worker (current: miami-ride-v1.29.0, full offline)
  content.json    — Single data file (venues, events, weather, handyman ad, UI strings)
  manifest.json   — PWA manifest
  analytics.json  — Persisted analytics export (IndexedDB → JSON via editor)
  images/games/   — Landmark images for Guess the Image game
tests/            — Playwright specs (see ## Test Suite below)
backlog.txt       — Open items, ranked priority list + test suite docs
backlog_archive.md — Completed items with full implementation notes
```

## Deployment
- **Worker project** on Cloudflare (NOT Pages). Deploy = `wrangler deploy` triggered by git push to `main`.
- `src/index.js` routes `/api/*` to `functions/api/*` modules. Static assets served from `public/`.
- Prod secrets (`ANTHROPIC_API_KEY`, `TICKETMASTER_KEY`) must be encrypted **Secrets** in Worker dashboard — `wrangler deploy` wipes plain-text vars.
- Local dev: `npm run dev` (Wrangler, port 8788). Static-only: `python -m http.server 8000` inside `./public`.
- **Bump `sw.js` `CACHE_VERSION`** on every push that touches `public/` assets.

## Content (`content.json`)
- **23 venues** (restaurants, attractions, nightlife, gems — including sponsored Gramps)
- **3 events**: Wynwood Music Series, Viernes Culturales, Art Deco Weekend
- **Handyman ad**: Abdullah's handyman service, phone `(786) 919-2115`
- **Languages**: EN / ES / PT / FR — all venue/event descriptions and UI strings translated

## Design System
- Theme: **Deco Dusk** (South Beach art-deco twilight palette)
- Colors: `--navy-deep #0C1A2E` · `--teal #19A0A8` · `--gold #E5C06B` · `--pink #FF5C8A`
- Fonts: DM Sans (body) · Marcellus (display/headings) · Poiret One (deco labels)
- Icons: Tabler Icons webfont `@tabler/icons-webfont@2.47.0`
- Cards use `var(--card-solid) #16294A` with `1px solid rgba(229,192,107,0.25)` gold border

## Key Details
- Dashboard default PIN: `1234` (user-changeable in Settings panel)
- GitHub settings (token, owner, repo, branch) stored in `localStorage` in the browser
- GPS used to sort venues by distance from current location
- Inactivity flow: 30s idle → attractor overlay → inactivity modal countdown → thanks screen → reset
- Abdullah is from Turkey; Mandolin Aegean Bistro is his top personal pick

---

## Code Patterns Reference

### Overlay / modal pattern
All full-screen overlays use `opacity:0; pointer-events:none` by default, toggled via a `visible` class.
Never use `display:none` for overlays — always check/set the `visible` class.
```js
el.classList.add('visible');     // show
el.classList.remove('visible');  // hide
await expect(locator).toHaveClass(/visible/);   // in tests
```

### Z-index layer cake
```
80  — QR modal
85  — Attractor overlay (idle screen)
87  — Feedback teaser card
88  — Feedback follow-up modal
90  — Inactivity modal
95  — Thanks screen
130 — Image lightbox
9999 — Mini toast (driver-only)
```

### Language helper
```js
aL(obj)   // attractor strings: picks obj[lang] || obj.en — use for attractor/feedback/teaser copies
t('key')  // content.json strings keyed lookup — use for main UI strings
lang      // current language string: 'en' | 'es' | 'pt' | 'fr'
```

### Key JS globals (module-level, index.html)
```
CONTENT         — parsed content.json (null until loaded)
db              — IndexedDB handle (null until openDB() resolves)
lang            — active language
liveWeather     — live Open-Meteo fetch result (null until Weather tab opened)
sessionStart    — null between sessions, Date.now() timestamp during active session
attractorActive — true while attractor overlay is visible
```

### IndexedDB schema (`MiamiRideAnalytics`, current version: 3)
```
sessions  — { id, startTime, endTime, day, duration, taps{}, tapTotal, firstTap, lang, endType }
taps      — { id, key, time, day, lang }
meta      — { k, n }  (k='cycles' → ride cycle counter)
feedback  — { id, ts, day, rating(1-5), chips[], text, partial, lang }
```
Version upgrade policy: gates are `if (oldVersion < N)` — never wipe stores unnecessarily.

### Attractor card shape
```js
{
  id: 'mycard',
  visual: '🎉',          // emoji string, OR
  visualHtml: '<div>…',  // raw HTML (use for complex visuals)
  isFeedback: true,      // optional — shows emoji-row, suppresses normal tap action
  headline: { en, es, pt, fr },
  sub:      { en, es, pt, fr },
  action: () => { … }    // null for feedback card
}
```
Cards live in `buildContentCards()` (content pool) or `ATTRACTOR_LANG_CARDS` (always-first language cards).
`renderAttractorCard(card)` sets the DOM; `onAttractorTap()` handles overlay-level taps.

### logTap / analytics
```js
logTap('my_key')   // increments sessionTaps, writes to taps store, resets inactivity
                   // keys starting 'attractor_' don't open a session
```

---

## Test Suite

Runner: Playwright. Config: `playwright.config.js` (Chromium, 1024×768, static server on port 8123).
All specs in `tests/`. Use `./fixtures` for flow tests (strict console-error gate); use `@playwright/test` directly for pure unit tests (CDN blips can't fail pure assertions).

```
npm test                  # all specs
npm run test:index        # @index — full passenger app
npm run test:feedback     # @feedback — ride feedback feature
npm run test:games        # @games — all games
npm run test:editor       # @editor — driver dashboard
npm run test:backend      # @backend — Cloudflare Functions
npm run test:weather / test:content / test:phone / test:rest
npm run test:smoke        # @smoke — critical path
npm run test:negative     # @negative — failure paths
npm run test:i18n         # @i18n — language/translation
npm run test:units        # @unit — pure function unit tests
```

**Spec files and what they cover:**
| File | Tags | Covers |
|------|------|--------|
| `passenger.spec.js` | @index | Home view, tabs, venue sheets, language switch, events |
| `index-units.spec.js` | @index @unit | haversine, formatPhone, buildVCard, date helpers |
| `feedback.spec.js` | @index @feedback | Emoji rating, follow-up modal, chips, DB persistence, teaser |
| `inactivity-tap.spec.js` | @index @games | Inactivity popup tap isolation, game reset after close |
| `rest.spec.js` | @index @rest | Blackout screen enter/wake/translate/auto-wake |
| `weather.spec.js` | @index @weather | Weather tab render, hourly/weekly, live fetch fallback |
| `phone.spec.js` | @index @phone | Phone number formatting, vCard |
| `content.spec.js` | @index @content | content.json schema validation, translation completeness |
| `games.spec.js` | @index @games | Game open/close, flows, i18n |
| `games-logic.spec.js` | @games @unit | Pure game logic (trivia scoring, word puzzle, etc.) |
| `editor.spec.js` | @editor | PIN login, venue edit, publish flow |
| `editor-units.spec.js` | @editor @unit | Editor helper functions |
| `backend.spec.js` | @backend | Cloudflare Function helpers (no live network) |
