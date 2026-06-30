# Miami Ride Companion — Archive

Completed items, resolved bugs, historical session notes, and past decisions.
Read this for context on why things are the way they are; not for daily work.

---

## Completed Items

### [X] Pre-warm event images into offline cache  *(DONE 2026-06-30, SW v1.65.0)*

Event images (from Ticketmaster CDN and soulofmiami.org) were never cached unless the passenger browsed the events list. Opening the app at home on Wi-Fi then driving to the car with no internet meant images were missing.

- `prewarmEventImages()` runs from `applyContent()` on every startup and content refresh
- Opens a dedicated `miami-event-images` cache; walks all event image URLs; fetches any not yet cached; skips already-cached entries; fails silently if CORS blocked or offline
- SW activate handler now preserves `miami-event-images` across version bumps (previously only `CACHE_VERSION` and `miami-map-tiles-v1` were protected)
- SW's `caches.match()` already searches all caches, so images serve offline automatically without any additional SW routing logic

---

### [X] Auto-refresh content on foreground / events tab  *(DONE 2026-06-30, SW v1.64.0)*

Content loaded at startup was never refreshed while the app stayed open. New events pushed overnight from RSS/Ticketmaster were invisible until a manual app reload.

- `refreshContent()` — silent background re-fetch; skips if content is <10 min stale; compares `meta.lastUpdated` to avoid unnecessary re-renders when nothing changed
- Triggered on `visibilitychange` (tablet wake, tab focus) — covers the "next day" scenario
- Also triggered on every Events filter switch so the events list always reflects current content when the passenger taps Events
- Attractor event-count cards update on the next attractor cycle (they rebuild from `CONTENT` via `buildContentCards()` at cycle start)

---

### [X] Business card QR with per-source analytics  *(DONE 2026-06-29, SW v1.63.0)*

- `/go/:source` Cloudflare Worker route redirects to `content.json businessCard.redirectUrl`; each placement (card, flyer, magnet, custom) gets its own QR code so scan source is tracked
- Cloudflare KV tracks total, per-source, and per-day click counts
- Editor "Business Card" panel: QR grid with PNG download per source, live stats (total scans, 14-day bar chart, breakdown by source), add/remove placements, editable destination URL
- QR library switched from qrcodejs to qr-code-styling for round dots with square corner markers for scannability
- Download exports at 1200×1200 for print quality (preview on screen stays compact; a separate high-res instance is generated for download so Canva/print shops get a crisp image)

---

### [X] Thanks card visual redesign + C4 attractor fix  *(DONE 2026-06-28, SW v1.62.0)*

- **Thanks screen** now uses the same card shell as attractor cards: dark background, gold border, 30px radius, 52px padding, matching font sizes — was visually mismatched before
- **Connect Four attractor card** visual replaced with a proper mini 4×3 CSS grid instead of the awkward 1|6|1 emoji layout

---

### [X] Driver bio ES/PT/FR translations  *(DONE 2026-06-28, SW v1.61.0)*

Both bio paragraphs in `content.json` had empty arrays for non-English languages. Natural translations added for Spanish, Portuguese, and French.

---

### [X] #49 — My Apps section on driver page  *(DONE 2026-06-28, SW v1.59.0 → v1.60.0)*

Three-column featured grid below the pets card showcasing Abdullah's other apps: Miami Ride Companion (active-now state), SoFlo Vegan Eateries, and LifeOS Planner.

- Inline QR codes generated via QRCode.js; tap-to-enlarge opens standard QR modal
- Both app taps logged to analytics (`driver_app_soflo` / `driver_app_lifeos`)
- All 11 strings (section header, companion state, SoFlo & LifeOS tags, scan label, QR modal descriptions) translated EN/ES/PT/FR in `content.json strings.myApps`; HTML elements wired with `data-key` so `applyStrings()` auto-applies on language switch

---

### [X] Thank-you card after feedback submit  *(DONE 2026-06-28)*

After tapping Submit in the feedback modal, a translated "Thank you for your feedback!" card shows for 5 seconds (with progress bar) before the promotional teaser. Skipping feedback still goes straight to the teaser as before. Tapping during the thank-you phase skips to the teaser early.

---

### [X] Attractor card staleness fix + bigger cards + faster cycling  *(DONE 2026-06-28, SW v1.57.0)*

- **Staleness bug fixed**: `attractorInCycle` reset to 0 on every `showAttractor()` call so `buildContentCards()` always runs fresh — was causing stale dates (showing yesterday's events) and count mismatches (card said "4 events" but list showed 3) when cycles never completed in a 60s session
- **Larger cards**: width 560→680px, emoji 72→88px, headline 32→38px, sub 16→18px, padding increased
- **Faster cycling**: card display time 7s→5s (~12 cards per session instead of ~8)

---

### [X] Smarter PWA install gate — platform tabs + browser picker  *(DONE 2026-06-27, SW v1.56.0)*

Replaced the static iOS/Android/other instruction blocks with dynamic step rendering:
- Platform tabs (iOS / Android) auto-detected from UA with gold `.ig-key` badges for tappable UI elements
- Android browser picker (Chrome / Samsung / Firefox / Edge) — correct instructions shown per detected browser
- Same 5-tap icon bypass for driver testing on laptop

---

### [X] Would You Rather + Color Tap games — polish pass  *(DONE 2026-06-26)*

Follow-up improvements to the two new games added same session:

- **WYR play layout**: "Would you rather…" shrinks to a compact header; both options stack vertically and each fills half the remaining screen height with 22px text (was a side-by-side 2-column grid with 13px text)
- **All pre-game intro screens** (TTT, C4, Tap Duel, Trivia Buzzer, WYR, Color Tap): dramatically larger on iPad — icon 84px, title 42px, body 18px; base sizes also bumped. Used full screen real estate instead of small centered card.
- **Biscayne Dash**: car speeds reduced ~35% and car width narrowed 1.9→1.4 cells to make the game playable in a moving car

SW bumped to `miami-ride-v1.55.0`.

---

### [X] Would You Rather + Color Tap games  *(DONE 2026-06-26)*

Two new games added to the Games tab, fully translated EN/ES/PT/FR.

**Would You Rather** (With Friends section)
- 20 questions covering Miami/travel, food, lifestyle, and silly topics
- Each question's A/B options are multilingual objects rendered with `gL()` — fully translated into ES/PT/FR
- Shuffled deck each game; tap A or B to pick (highlights in teal/gold), Next button appears after pick, end screen after all 20
- Registered in `GAMES` registry; smoke-tested open/close

**Color Tap — Stroop Effect** (Solo section)
- Color word (e.g. "RED") displayed in a different color (e.g. blue); tap the color you see, not the word
- 6 colors fully translated (RED/ROJO/VERMELHO/ROUGE etc.) rendered with `gL()`
- 3-second countdown bar that shifts teal→gold→pink; auto-advances 900ms after answer; 10 rounds
- End screen with score and performance label (Stroop Master at 8+)
- `ctStopTimer()` hooked into `closeGames()` so no RAF leaks on close

**Translation system**: all UI chrome (`data-gkey` on every static string), dynamic strings use `gt()` / `gL()` at render time. Smoke test coverage added for both games (`wyr`, `ct`).

SW bumped to `miami-ride-v1.54.0`.

---

### [X] Google Analytics GA4 — comprehensive "all in" tracking  *(DONE 2026-06-26)*

Full GA4 instrumentation added to Miami Ride Companion. Separate from the custom IndexedDB analytics (which generates JSON reports); this tracks phone PWA installs and all user interactions in GA4 property `G-MCCTMMYD5R` (shared account, separate property from Miami Vegan App).

**GA4 snippet** added to `<head>` with `send_page_view: false`; `track()` helper wraps `gtag()` with null-guard.

**Events wired (30+ total):**

| Event | When |
|---|---|
| `page_view` | App boot (`pwa_mode: standalone\|browser`) |
| `install_gate_shown` | Gate shown (`platform: ios\|android\|other`) |
| `install_gate_bypassed` | 5-tap developer bypass |
| `language_switch` | Language picker tap |
| `tab_view` | Tab navigation (`tab_name`) |
| `filter_applied` | Category filter chip (`filter_name`) |
| `venue_view` | Venue sheet open (`venue_name`, `venue_category`) |
| `qr_opened` | QR modal open (`qr_type`, `qr_id`) |
| `game_open` | Any game opened (`game_name`) |
| `attractor_shown` | Attractor overlay shown |
| `attractor_tap` | Attractor card tapped (`card_id`) |
| `feedback_rating` | Emoji feedback selected (`rating` 1-5) |
| `feedback_submitted` | Modal submit (`rating`, `chips_count`, `has_text`) |
| `feedback_skipped` | Modal skip (`rating`) |
| `feedback_teaser_tap` | Teaser CTA tapped |
| `game_outcome` | Win/draw for TTT, C4, Duel (`game`, `result`, `winner`) |
| `game_duel_false` | False start in Reaction Duel (`player`) |
| `game_buzzer_timeout` | Buzzer timer expired (`player`) |
| `game_trivia_answer` | Trivia answered (`correct`, `score`) |
| `tap_final_score` | Tap Frenzy round ends (`score`, `is_best`) |
| `game_word_guess` | Word puzzle guess (`correct`, `word_length`) |
| `game_spin` | Facts Spinner spin (`count`, `category`) |
| `game_img_answer` | Guess the Image answered (`correct`) |
| `frogger_cross` | Frog crosses Biscayne Blvd (`score`) |
| `inactivity_modal_shown` | "Still there?" modal appears |
| `inactivity_dismissed` | User taps to stay |
| `session_end` | Thanks screen shown |
| `rest_enter` | Rest/blackout screen activated |
| `rest_exit` | Rest screen dismissed |
| `image_lightbox_open` | Photo lightbox opened |

**user_properties** set at boot: `pwa_mode` (`standalone` / `browser`) for segmenting PWA installs vs. browser users.

SW bumped to `miami-ride-v1.53.0`.

---

### [X] Test suite — Biscayne Dash + PWA gate coverage  *(DONE 2026-06-26)*

**Critical fix:** The PWA gate's early `return` in `DOMContentLoaded` was preventing `bootApp()` from running in Playwright's non-standalone browser context — every test loading `index.html` was silently broken.
- Gate check extended: `|| localStorage.getItem('pwa-bypass') === '1'`
- `fixtures.js`: `page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'))` added before `use(page)` — all fixture-based tests bypass automatically.
- `games-logic.spec.js` (uses `@playwright/test` directly): top-level `test.beforeEach` adds the same initScript before each `goto`.

**New `pwa-gate.spec.js`** (4 tests, `@index @smoke`):
- Gate visible + `#app` hidden in browser context
- Correct platform panel shown (Chromium → "other")
- 5 taps on icon bypass gate and boot app
- `@negative` 4 taps don't bypass

**New Frogger logic tests in `games-logic.spec.js`** (8 tests, `@games @unit`):
- Start state: correct row/col/score/lives/running
- All 4 moves change position by exactly 1 cell
- Reaching row 0 → score +10, `froggerCelebrating = true`
- Movement blocked during celebration
- `frogKill` decrements lives, sets dead flag, updates DOM
- 3 deaths → `froggerOver = true`, shows 💀
- `@negative` dead blocks movement
- `@negative` game-over triggers restart on next `frogMove`

**New Frogger i18n test in `games.spec.js`** (1 test):
- Card title and HUD "Score" label re-render in ES on language switch

SW bumped to `miami-ride-v1.51.0`.

---

### [X] Biscayne Dash (Frogger)  *(DONE 2026-06-26)*

Canvas-based Frogger clone added as a solo game. Miami-themed: cross 6 lanes of traffic on Biscayne Blvd.

**What shipped:**
- `initFrogger()` / `stopFrogger()` / `froggerFrame()` game loop using `requestAnimationFrame`.
- 10×9 grid: goal row at top, 3 lanes + safe median + 3 lanes + start row.
- 6 lane configs (alternating directions, varying speeds), 2-3 cars per lane using emoji (🚗🚙🚕🚌🏎️), colored rounded-rect car bodies.
- 3 lives (🐸🐸🐸 in header), 💥 on hit with 1s respawn delay, game over overlay.
- +10 score per crossing; `logTap('game_frogger_cross')` on each.
- D-pad (3×3 grid of buttons) + swipe detection on the canvas.
- Tap any direction after game over to restart.
- Attractor card: "Cross Biscayne Blvd — dare you?" in all 4 languages.
- Hooked into `closeGames()` so the rAF loop stops cleanly on back.
- SW bumped to `miami-ride-v1.47.0`.

**Bypass secret (same session):** 5 taps on the install gate icon launches the full app in browser mode — for driver testing on laptop. SW bumped to `miami-ride-v1.48.0` for that addition.

**Follow-up polish (2026-06-26):**
- Celebration animation on crossing: 40 confetti particles burst from frog position (physics: gravity + velocity, random colors from Miami palette), "+10" gold text rises and fades, flanked by 🎉 emojis. Frog frozen for 1.8s during celeb, then resets.
- HUD: score/lives moved out of the tiny header badge into a centered two-stat bar (26px gold Marcellus font, deco-font label above each) directly above the canvas.
- Attractor idle delay: 30s → 60s. Attractor run duration: 28s → 60s (~8 cards). SW bumped to `miami-ride-v1.49.0`.

---

### [X] PWA install gate  *(DONE 2026-06-26)*

Browser-detection screen shown to passengers who open the app link in a mobile browser instead of the installed PWA.

**Why:** Browser chrome (address bar + navigation panels) eats 10-15% of screen height on mobile. The app is designed for full-screen PWA use and looks cramped in a browser tab.

**What shipped:**
- On `DOMContentLoaded`, checks `matchMedia('(display-mode: standalone)')` and `navigator.standalone` (iOS Safari).
- If in a browser: hides `#app`, shows `#install-gate` with platform-specific steps, then returns — full app never initializes.
- If PWA: hides the gate, boots normally.
- Install gate shows app icon (`icon-192.png`) with rounded corners and gold glow.
- Three instruction panels (iOS Safari, Android Chrome, generic) — correct one shown via UA detection.
- SW bumped to `miami-ride-v1.46.0`.

---

### [X] #51 + #53 — Events category field, filter chips, attractor cards, analytics  *(DONE 2026-06-25)*

**Closed set of 6 categories:** `music | sports | comedy | arts | nightlife | food-drink`

**What shipped:**
- All 75 existing events in `content.json` assigned a `category` field (keyword heuristic + manual overrides for edge cases).
- `daily-refresh.mjs` now auto-assigns `inferEventCategory()` to any new event that arrives without one.
- Filter chip strip (`All · 🎵 Music · ⚽ Sports · 😂 Comedy · 🎭 Arts · 🎉 Nightlife · 🍹 Food`) appears above the event grid when Events filter is active. Only chips with ≥1 upcoming event are shown. Active chip state visually highlighted.
- Event card badge now shows the category emoji + label instead of the generic "Event" tag.
- `logTap('event_filter_<cat>')` on chip tap; `logTap('event_open_<cat>')` on card tap.
- Category-specific attractor cards added to `buildContentCards()` for each category with ≥2 upcoming events — e.g. "42 Music events near you".
- Attractor card tap pre-selects that category then navigates to the Events tab.
- Editor: category dropdown in "Add Event Manually" form; category shown in event row meta.
- SW bumped to `miami-ride-v1.45.0`.

**Analytics unlocked:** `event_open_<cat>` taps are now captured. Feeds into backlog #52 (editor analytics breakdown) and informs manual event curation over time.

**Unlocks:** backlog #52 (analytics category breakdown in editor) and #53 (already implemented as part of this item — attractor cards).

---

### [X] Daily refresh pipeline hardening  *(DONE 2026-06-25)*

End-to-end fixes to the GitHub Actions daily-refresh job after it was silently failing.

**Root cause:** `WORKER_URL` GitHub secret pointed to `metrekare.workers.dev` (GitHub
username) instead of `miamicompanionapp.workers.dev` (Cloudflare account subdomain).
Both RSS and Ticketmaster fetches returned "fetch failed" (network-level) with no
diagnostics. Script continued and committed unchanged event data every day.

**Fixes shipped:**

1. **Error logging** — script now logs the Worker hostname at startup so the wrong URL
   is immediately visible in Actions logs; `err.cause` is included in fetch failure
   messages (Node native fetch buries the real error there, not in `err.message`).

2. **AI review prompt** — tightened skip criteria: news articles, blog posts, deals/
   coupons, empty/blog-name venue (strong signal it's an article not an event),
   recurring daily tourist packages (bus tour combos, arena backstage tours), and
   niche local shows with no recognizable acts. Previously only "too niche" and
   "outside South Florida" were listed — Sonic deal and airplane museum articles
   were passing through.

3. **Cross-run title+venue dedup** — the URL dedup prevented exact-URL duplicates but
   Ticketmaster lists recurring daily packages (e.g. "Ride and Dine!") with a fresh
   URL per day. Added `seenTitleVenue` Set built from pre-existing events; incoming
   events are skipped if title+venue already exists, regardless of URL.

4. **Venue trim fix** (`ticketmaster-fetch.js`) — Ticketmaster API returns trailing
   whitespace on some venue names (e.g. `"Amerant Bank Arena "`). This caused
   title+venue keys to not match the stored entry, allowing duplicate events. Fixed
   with `.trim()` in `mapEvent()` and defensively in the dedup key builder.
   Test added: `backend.spec.js` "trims trailing whitespace from venue name".

5. **Persistent review cache** (`scripts/review-cache.json`) — AI verdict (keep/skip)
   is now saved by `title|venue` key after each run and committed alongside
   `content.json`. Skip entries act as a permanent blocklist (event never re-added
   even if it ages out of content.json and Ticketmaster resurfaces it). Keep entries
   skip the Claude API call on future runs. GitHub Actions workflow updated to
   `git add scripts/review-cache.json`. Pre-seeded with 4 known skips: Welcome to
   Destruction, Off Campus Night, Sonic deal, airplane museum article.

---

### [X] #36 Fix landing image blink on GPS re-render in a moving car  *(DONE 2026-06-23)*

Root cause: `watchPosition` fires every ~2–3 seconds in a moving car. Each fire called `renderGuide()` → full `innerHTML` rebuild → every `<img>` destroyed and recreated → visible blink.

**Fix:** two-pronged approach in `startGPS` callback:

1. **Home/featured view — in-place distance updates.** `updateHomeDistances()` (new function) walks the existing DOM (`#gp-hero-slot .gp-hero-dist`, `#gp-minis .gp-mini[data-vid]`) and updates only the distance badge text and color class. No `innerHTML` rebuild, no image blink at all.

2. **Browse view — 15-second throttle.** Sort order can shift as the car moves, so a full `renderGuide()` is still needed, but limited to once every 15 seconds (down from every ~2–3 s).

3. **First GPS fix** always triggers a full `renderGuide()` (via `_gpsAcquired` flag) so distance badges appear for the first time.

No changes to `watchPosition` options or GPS accuracy settings.

---

### [X] #50 Ticketmaster VIP query — surface high-profile events buried by MAX_EVENTS cap  *(DONE 2026-06-23)*

Root cause: the main query sorts `date,asc` and caps at 25 results, so near-future small shows fill all slots. A Shakira concert 6 weeks out was silently dropped.

**Fix:** added a parallel "VIP" query in `ticketmaster-fetch.js` using `Promise.allSettled`:
- Filters to `segmentId=KZFzniwnSyZfZ7v7nJ` (Music segment)
- Same geo center + 45-mile radius
- 90-day lookahead window (`endDateTime`)
- `size=50`, `sort=date,asc`
- Results merged and deduplicated by `title|venue` key across both queries
- Combined cap raised to `MAX_EVENTS * 2` (50) — AI review in the daily pipeline trims further

Both queries run in parallel; either can fail independently without blocking the other. No changes needed in the editor, daily pipeline, or passenger app.

---

### [X] #17 Daily events + weather auto-refresh via GitHub Actions  *(DONE 2026-06-23)*

Full pipeline runs every morning at 8 AM EDT with no manual steps.

**What was built:**
- `.github/workflows/daily-refresh.yml` — cron at `0 12 * * *` (8 AM EDT), also triggerable manually via workflow_dispatch
- `scripts/daily-refresh.mjs` — pure Node.js orchestration script (no npm deps, uses built-in fetch)

**Pipeline steps in order:**
1. Load `public/content.json`
2. Drop events with `date < today` (Miami timezone)
3. Call deployed Worker's `/api/rss-fetch` → merge new events (dedupe by URL)
4. Call deployed Worker's `/api/ticketmaster-fetch` → merge new events (dedupe by URL)
5. Geocode new RSS events missing lat/lng via Nominatim (1 req/sec rate limit)
6. AI review (Claude Haiku) — only newly fetched events rated keep/skip; pre-existing events not re-reviewed
7. Drop "skip" events before writing
8. Translate new events to ES/PT/FR in batches of 5 (Claude Haiku)
9. Refresh weather snapshot from Open-Meteo (same URL/shape as the editor's fetch)
10. Write `content.json`, commit, push → triggers `wrangler deploy` automatically

**AI review prompt uses "outside South Florida (Homestead to Boca Raton)"** — same geography as the editor (updated 2026-06-23 to stop Fort Lauderdale/Davie being flagged as too far).

**Failure handling:** each step is independently try/caught; a Claude outage skips review/translation but still writes updated events + weather.

**Secrets required in GitHub repo settings:**
- `ANTHROPIC_API_KEY` — Claude API key
- `WORKER_URL` — deployed Worker base URL (e.g. `https://miami-ride-companion.metrekare.workers.dev`)

---

### [X] Full venue image coverage — 45 images placed, 3 closed venues removed  *(DONE 2026-06-14)*

All 54 venues audited for image coverage. Images were found, staged, reviewed, compressed, and placed.

**What was done:**
- Found images for all 49 venues that were missing photos (4 already had local files, 1 had an external URL)
- Sources: Timeout Miami, miamiandbeaches.com, visitlauderdale.com, official venue sites, Cloudflare/Squarespace CDNs
- 4 oversized files compressed with sharp (mozjpeg, max 1200px wide): `joey-aventura` 6.4MB→182KB, `r-house-wynwood` 3.3MB→376KB, `medium-cool` 2.7MB→146KB, `timo-restaurant` 2.2MB→87KB
- 45 image files copied to `public/images/venues/`
- All photo fields in `content.json → guide.venues[*].photo` updated

**3 closed venues removed from content.json:**
- v004 Gramps — closed May 2026
- v048 Sugarcane Raw Bar Grill — closed May 2026
- v050 Beaker & Gray — closed December 2025

Venue count: 54 → 51. SW bumped to v1.38.0.

### [X] Honest regional framing + color-coded distance badges  *(DONE 2026-06-14)*

A passenger riding near Kendall tapped the "Miami nightlife" attractor and reacted that the venues "are not from Miami, these are too far" — because the nightlife list actually spans South Beach → **Hollywood (DAER)** → **Fort Lauderdale (Original Fat Cat's, ~25 mi)**. The "Miami" label was over-promising the coverage area, and distance was effectively invisible.

**Root cause (two parts):**
1. **Copy over-promised "Miami."** Attractor headlines named a single city the venue pool doesn't honor. Nightlife reaches Broward; attractions include **Fort Lauderdale** and the **Everglades**.
2. **Distance was invisible/unsorted without GPS.** Venue cards only set `v._dist` and sorted nearest-first inside `if (userLat && userLng)` (`renderGuide`, index.html). When GPS hadn't resolved, far venues appeared in arbitrary order with no distance shown and nothing flagging them as far.

**Changes (`public/index.html`):**
- **Reframed two attractor cards** in `buildContentCards()` (all 4 languages: EN/ES/PT/FR):
  - Nightlife: "Miami nightlife" → **"South Florida nightlife"** / sub "…from the beach to Broward".
  - Attractions: "Top Miami attractions" → **"South Florida attractions"** / sub now names "…the Everglades & more".
  - **Intentionally left as-is:** Food already said "Best restaurants **near you**"; Gems already said "**Local** hidden gems" (no city claim); Events (Wynwood / Little Havana / South Beach) and Weather/Trivia are genuinely Miami.
- **Color-coded distance badges** — new `distClass(mi)` helper (next to `haversine`) returns a tier class: green `dist-near` ≤6 mi, gold `dist-mid` ≤12 mi, red `dist-far` >12 mi (`null`/`undefined` → `''`). Applied to all four badge render spots: home hero (`buildHeroHTML`), mini cards (`buildMiniHTML`), browse grid (`buildVenueCard`), and the venue detail sheet (`openVenueSheet`). This treatment is app-wide (per-venue), so every category benefits, not just nightlife.
- **CSS** (after the `.vs-dist` rules) overrides the default `var(--teal)` with `#34D399` / `var(--gold)` / `#FF6B6B`. The venue-sheet selector is `.vs-meta .vs-dist` (specificity 0,2,0), so the far/mid/near overrides are doubled as `.vs-meta .dist-*` to win the tie; the other three badges are single-class and win on source order.
- SW bumped to **v1.35.0**.

**Tests (`tests/index-units.spec.js`, +4):**
- `distClass` tier boundaries (0/6/6.01/12/12.01/25 → near/near/mid/mid/far/far) and the `null`/`undefined` → `''` guard.
- Attractor-copy honesty: nightlife & attractions headlines/subs contain **no "Miami"** in any of the 4 languages; nightlife English headline === "South Florida nightlife". Guards against a future edit silently reintroducing the over-promise.

**Decision notes / open follow-ups:**
- Thresholds 6/12 mi are a first guess at "near vs a real drive" for a typical ride; revisit if rides cluster tighter (e.g. Brickell↔Wynwood) — change is centralized in `distClass()`.
- Weather still fetches a fixed Miami location; a passenger in Broward sees Miami weather. Out of scope here, noted as a possible future item.

### [X] #7 — iPad real-device test  *(DONE 2026-06-15)*

Tested the full redesign on the actual iPad in the car. App is stable and passengers can use it comfortably. Deco Dusk theme is readable, tap targets are good. No regressions found.

### [X] #34 — BUG: driver bio photo cropped (shoulders cut off)  *(DONE 2026-06-15)*

Appeared misaligned on desktop (`.dp-bio-photo img` uses `object-fit:cover; object-position:center 22%`), but looks correct on the real iPad. No code change needed — desktop rendering was a non-issue.

### [X] #41 — Editor PIN login back button  *(DONE, confirmed 2026-06-15)*

Added a "← Back to passenger view" link to the editor PIN login screen so drivers can exit without unlocking.

- `<a href="/">← Back to passenger view</a>` link below the Unlock button in the `.auth-box`.
- No JS needed — plain anchor navigates back to index.html.

### [X] Attractor backdrop dismiss — tap outside card dismisses without redirecting  *(DONE 2026-06-13)*

Changed attractor overlay tap behavior so tapping the dark backdrop (outside the card) only dismisses the overlay, while tapping the card itself still fires the action (tab switch, game open, etc.).

- `attractor-overlay` onclick changed to `onAttractorBackdropTap()` — hides + resets inactivity, no action.
- `attractor-card` gains `onclick="event.stopPropagation(); onAttractorTap()"` — fires the card action.
- New `onAttractorBackdropTap()` function added.
- Feedback emoji buttons unaffected (they already had their own `stopPropagation`).
- Hint text updated from "Tap anywhere to browse" → "Tap the card to explore" (all 4 languages).
- SW bumped to v1.34.2.

**Why:** Passenger mid-game (e.g. Trivia) would tap to dismiss the attractor and accidentally get redirected away from the game.

### [X] Handyman attractor card + card size bump + language sidebar pulse  *(DONE 2026-06-21, SW v1.42.0)*

Three improvements shipped together based on analytics review (Jun 21 export) and passenger observation (Portuguese passengers not noticing language selection).

**Handyman attractor card**
- New card `id: 'handyman'` added to `buildContentCards()` in `index.html`.
- Visual: 🔧. Headline: "Need something repaired in South Florida?" Sub: "Your driver is also a handyman\n[service list] — tap for details". Line break implemented via `\n` in the sub string + `white-space: pre-line` on `.attractor-sub`.
- Action: `switchTab('driver')` — opens the Driver tab where passengers see the handyman phone number and QR codes.
- Fully translated EN/ES/PT/FR.
- Motivation: analytics showed zero handyman QR taps across all sessions; the service info was invisible because nothing in the attractor rotation pointed to the Driver tab.

**Attractor card size bump**
- Card width: `460px → 560px` (`min(560px, 90vw)`)
- Headline: `26px → 32px`
- Sub text: `14px → 16px`
- Visual emoji: `62px → 72px` (min-height `70px → 80px`)
- Motivation: tablet is read from ~2 ft away at an angle; larger text is meaningfully more legible from the passenger seat.

**Language sidebar pulse**
- When `hideAttractor()` fires (every time the attractor overlay is dismissed), `.lang-section` in the sidebar gets the `pulsing` class: a teal glow that pulses 4× (~900ms each) then stops.
- CSS: `@keyframes lang-pulse` — alternates between transparent background and `rgba(25,160,168,0.15)` + teal box-shadow. Class removed via `animationend` listener with `{ once: true }`.
- Force-reflow (`void ls.offsetWidth`) ensures re-adding the class always restarts the animation mid-session.
- Motivation: Portuguese passengers in the car didn't notice the language switcher was in the sidebar. Option 2 (inline strip in guide header) was prototyped and reverted — it only appeared on the guide page and not weather/games. Pulse chosen because the sidebar is always visible across all tabs.

**Tests added** (`tests/index-units.spec.js`, tag `@index @unit`):
- Handyman card exists in pool with correct shape (visual 🔧, action is function, not feedback card)
- Handyman card has non-empty headline + sub in all 4 languages
- Handyman card sub.en contains `\n` for the line break
- Handyman card action navigates to the driver tab
- `hideAttractor()` adds `pulsing` class to `.lang-section`

### [X] Analytics disable toggle in Driver Menu  *(DONE 2026-06-13)*

Added "Analytics: On/Off" toggle to the 5-tap secret Driver Menu so testing sessions don't contaminate real passenger data.

- New `let analyticsDisabled = false` module variable.
- `logTap()` returns early (no DB write, no session start) when disabled.
- `endSession()` skips the session DB write and `recordCycle()` call when disabled — so the cycle counter stays clean too.
- New `secretToggleAnalytics()` function; follows the same pattern as `secretToggleBubble()`.
- Menu button added below Driver Bubble with same `danger` style and `ti-chart-bar-off` icon.
- State resets on page reload (intentional — prevents accidentally leaving analytics off for passengers).

### [X] #23 — Passenger ride feedback  *(DONE 2026-06-12)*

**Feature: in-app emoji rating with follow-up modal and teaser card**

Flow:
1. A new **feedback attractor card** ("How's your ride so far?") joins the regular idle-screen rotation (1 in 13 cards). It renders 5 emoji buttons (😄 😊 😐 😕 😢) using `stopPropagation` so each button registers independently.
2. **Positive path (😄 or 😊):** record saved immediately (rating, no chips, no text, `partial: false`); after 800 ms the teaser card appears.
3. **Neutral / negative path (😐 😕 😢):** follow-up modal slides up from the bottom. Contains 6 toggleable grievance chips (car cleanliness, driving comfort, pickup location, AC/temperature, music/noise, communication) + an optional 200-char textarea. Buttons: **Submit** (saves all; `partial: false`) and **Skip** (saves empty; `partial: true`). Modal auto-dismisses after 45 s saving any partial chip selection.
4. **Teaser card** appears after every path (immediately for skip/auto-dismiss, after 200 ms for submit, after 800 ms for positive). Rotates randomly among 4 options: upcoming events, restaurants, weather, Miami Trivia. 10-second animated progress bar auto-dismisses it; tapping the CTA navigates into the app.

Storage:
- IndexedDB `MiamiRideAnalytics` DB bumped from v2 → v3 (non-destructive: existing `sessions`/`taps` data preserved; only adds the new `feedback` object store).
- Each record: `{ id, ts, day, rating (1–5), chips: [], text, partial, lang }`.
- `upgradeAnalyticsDB` now gates destructive wipe behind `oldVersion < 2` so future bumps are safe.

Analytics overlay:
- New **Ride Feedback** section at the bottom: avg rating, per-emoji counts, chip frequency badges, up to 5 recent comments.

Tests (`tests/feedback.spec.js`, tag `@feedback`):
- 16 tests: attractor pool membership, emoji-row show/hide, positive/negative paths, chip toggle, submit/skip DB persistence, auto-dismiss partial-save logic, teaser navigation, i18n headline update, analytics overlay rendering + avg-rating math.
- `npm run test:feedback` added to package.json.

### [X] Session 2026-06-11 — Love Life Cafe + Live weather fetch

**Love Life Cafe added (v023)**
- Added as the 23rd venue in `content.json` (id: v023), category: restaurant, Wynwood neighborhood.
- Address: 545 NW 26th St, Miami FL 33127. Photo from spotapps CDN. All 4 language descriptions included.

**Live weather fetch in index.html (#39)**
- `index.html` now calls Open-Meteo directly when the Weather tab is opened (no GitHub deploy needed).
- New `fetchLiveWeather()` async function — fetches, parses, stores in `liveWeather` module var.
- 15-minute client-side cache: subsequent tab switches within a session reuse the fetched data.
- `renderWeather()` uses `liveWeather` first, falls back to `CONTENT.weather` snapshot when offline.
- `isStale` logic disabled when live data is present; badge shows "Live · fetched just now".
- Attractor card temp (`buildContentCards`) also uses live data when available.
- No change to editor.html weather workflow — content.json snapshot still serves as offline fallback.

### [X] #38 — Offline map tab for passengers  *(DONE 2026-06-08)*
Added a full-screen Map tab to the passenger app powered by Leaflet + OpenStreetMap.
- MAP TAB: 4th nav item in sidebar (City Guide / Weather / Games / Map), full-bleed Leaflet map.
- GPS DOT + DIRECTION CONE: live pulsing dot tracks passenger position; cone rotates to show
  direction of travel using `coords.heading` (fades out when stationary).
- AUTO-CENTER: map follows GPS by default; panning breaks follow-mode and shows a teal
  "Re-center" button that floats up from the bottom. Resets to auto-follow on next tab switch.
- SPEED + COMPASS HUD: bottom-left badges show mph and compass direction/degrees from GPS.
- ZOOM LIMITS: min 10 (region), max 16 (street detail); custom +/- buttons, no default Leaflet zoom control.
- OFFLINE TILE CACHE: separate `miami-map-tiles-v1` SW cache (survives app version bumps).
  OSM tiles cached on first browse, cache-first thereafter. Status badge turns teal and shows
  tile count when offline tiles are present.
- DRIVER DASHBOARD — OFFLINE MAPS PANEL: new section under System in editor.html.
  Radius slider 10–50 mi (default 30 mi), zoom 10–14, live tile/MB estimate. "Download tiles"
  sends full tile list to SW via postMessage; progress bar fills as SW reports batches.
  "Clear cache" wipes tile store. Status card reads live tile count from Cache API.
- SW v1.28.0: Leaflet CDN assets added to pre-cache; tile download job uses 6 concurrent
  requests + 40 ms batch delay for polite rate limiting; `event.waitUntil` keeps SW alive
  during long downloads.
- Analytics: Map tab tracked in TAB/TAB_LABEL/tabCounts.

### [X] #37 — Analytics overhaul: real sessions + behavioral metrics  *(DONE 2026-06-08)*
Reworked analytics so the numbers reflect actual passenger use, not idle loops.
- SESSION REWORK: a session now opens lazily on the FIRST IN-APP TAP (attractor
  taps that just wake the app are excluded). Empty idle cycles (driving with no
  passenger tapping) record nothing — fixes the "300 sessions, 0 taps" inflation.
- CYCLES COUNTER: every idle/auto-wake reset increments a `cycles` count in a new
  IndexedDB `meta` store. Engagement rate = sessions ÷ cycles (always ≤ 100%).
- NEW PER-SESSION DATA: `firstTap` (entry point), `tapTotal`, `day` bucket; taps
  also carry a `day` bucket.
- DRIVER-TAB INSTRUMENTATION: pet-photo taps (`driver_pet_<name>`), bio photo
  (`driver_photo`); the two contact QRs split into Save-my-number vs Thumbtack.
- REPORTING (editor dashboard + in-app peek): "Where passengers start" (entry
  points), "Games — opened vs played" funnel (from game_open_* vs game_*_start),
  "Driver page taps", "Sessions by day", plus Cycles + Engagement stat cards.
  Export JSON now includes `cycles`; reset clears the `meta` store too.
- MIGRATION: IndexedDB bumped to v2 across all 3 open sites (app openDB, in-app
  peek reader, editor). v2 upgrade drops the legacy phantom-inflated sessions/taps
  ONCE per device (intentional clean slate) and adds `meta`. SW → v1.27.0.
- CAVEAT: the one-time wipe fires on whichever page opens the DB first after the
  new build; if app + editor are open in two tabs at that exact moment the v2
  upgrade can `onblocked`-stall until one closes (non-issue on the single tablet).

---

### [X] Analytics: ghost-session fix + data quality improvements  *(DONE 2026-06-11)*
First real analytics export reviewed (Jun 9–11, 1,078 cycles). Two bugs found and fixed; several data gaps closed.

- GHOST SESSION BUG (fix): `switchTab('guide')` + `setFilter('featured')` called from `showThanks()` and `autoWakeRest()` always fired `logTap()`, creating a 2-tap session skeleton (`tab_guide + filter_featured, ~62s`) on every idle reset cycle. These saved as real sessions, inflating the count ~100x (1,064 of 1,074 sessions were noise). Fix: added `silent=true` param to both functions; reset paths call them silently.

- VENUE TRACKING BUG (fix): hero card and mini-card click handlers called `openVenueSheet()` directly without `logTap('venue_')`, so those taps never reached `topVenues` in the summary. Only the card-grid handler logged it. Fix: moved `logTap('venue_<id>')` into `openVenueSheet()` itself (single source for all entry paths); removed the duplicate call from the card-grid handler.

- GAME PLAY SIGNALS (4 games): trivia, word, spin, and image had `plays: null` in the export because no play-start signal existed. Added:
  - `answerTrivia()` → `game_trivia_answer`
  - `checkWord()` → `game_word_guess`
  - `doSpin()` → `game_spin_spin`
  - `answerImg()` → `game_img_answer`
  - `GAME_PLAY_PREFIX` updated in both `index.html` and `editor.html`.

- ENGAGED SESSIONS METRIC: both files now compute `engagedSessions` = sessions with `tapTotal > 2`. Analytics overlay and editor dashboard stat card now show "engaged / all" (e.g., `10 / 1074`) instead of raw session count.

- TIME-OF-DAY BREAKDOWN: `summarizeForPeek` now computes `byHour` (local time). In-app analytics overlay gained two new sections: "Sessions by day" and "Sessions by hour (local)" with bar chart.

- BASELINE: Jun 9–11 real engagement = 10 sessions. City Guide is 100% of entry points; attractor overlays work; venue cards rarely drilled; Weather tab almost invisible; all-English passengers so far.

---

### [X] #28 — Animated attract/idle screen  *(DONE 2026-06-03)*
Rotating tappable attractor slotted into the idle window (before the "Still
browsing?" countdown). Flow: idle → after ~20-30s start rotating teaser prompts
while app STAYS usable → (still no touch) → existing 60s→15s countdown → thanks.
Every prompt is a tappable deep-link (navigates + resets inactivity timer):
- "See what's happening in Miami this weekend" → Events tab (teases soonest event)
- "Best restaurants closest to you" → venues sorted by GPS distance
- "Play Miami trivia" → launches Trivia game
- "Play a game with your friends" → multiplayer games
- live weather teaser ("☀️ 84°F in Miami right now") → Weather tab
- LANGUAGE SELF-SELECT: "También disponible en español" in Spanish (+ PT/FR) so
  it self-selects the riders who need it; tapping switches language.
Tone: calm, ONE message at a time, slow ~5-6s crossfade, NOT flashing. No
handyman/sponsored content in rotation — helpful-utility only.
Reuses rotating-subtitle machinery + existing inactivity timer (no parallel timer).

---

### [X] #31 — Secret-tap driver menu + analytics peek  *(DONE 2026-06-07, sunday-sprint)*
Consolidated the secret 5-tap gestures into one hidden menu.
- ENTRY POINT: sidebar header 5-tap (initSecretTap) now opens a menu overlay
  instead of jumping straight to /editor.html.
- MENU ITEMS: a) Open Editor, b) Analytics peek (read-only on-device summary —
  works fully offline via same-origin IndexedDB), c) Driver Bubble on/off toggle.
- Footer 5-tap bubble toggle (initBubbleToggle) KEPT WHERE IT IS in addition.
- Analytics overlay: session count, avg duration, QR taps, tab split, language
  split, top 5 venues. READ-ONLY (no export/reset — those stay in the editor).

---

### [X] #26 — BUG: featured/sponsored flags conflated  *(DONE 2026-06-07, sunday-sprint)*
Previously: `featured:true` showed a badge labelled "Sponsored" (wrong label),
and saveVenue wrote BOTH `featured` AND `sponsored` from the same checkbox.
Fix: gave `featured` its own correct badge; added a separate sponsored toggle;
stopped the double-write. Also introduced `featuredMiniIds` list to curate the
3 featured-landing minis without reusing the conflated `featured` flag.

---

### [X] #22 — Celsius support on weather page  *(DONE 2026-06-07, sunday-sprint)*
Added °C in parentheses next to °F (e.g. "75°F (24°C)") — always-show-both
parenthetical approach. Language != unit preference, so locale-based auto-switching
was rejected; safer to show both. Unit toggle in editor/settings deferred as future.

---

### [X] #35 — Tap any photo to enlarge (shared lightbox)  *(DONE 2026-06-07, sunday-sprint)*
Single `openImage(src)` overlay wired onto driver bio, queen, pets, venue cards/
sheet, event banners. One reusable modal — not per-element implementations.

---

### [X] #25 — Editor UI for 3 featured mini cards  *(DONE 2026-06-07, sunday-sprint)*
Added multi-select (3 dropdowns) in editor City Guide / Featured section next to
the existing featuredVenueId hero picker. Persists array order; survives publish
since editor carries unknown guide fields through.

---

### [X] #29 (partial) — Tap Frenzy i18n EN/ES/PT/FR  *(DONE 2026-06-07, sunday-sprint)*
Wired Tap Frenzy result messages + "Best tap score" header pill into the i18n
system. Word Puzzle deferred (see open item #29a).

---

### [X] #30d — Connect Four (2P)  *(DONE 2026-06-07, sunday-sprint)*
Full Connect Four implementation + 5 logic tests. Column button alignment fixed
in follow-up (SW bump v1.26.1).

---

### [X] #33 — "Nearest to you" subtitle misleading on featured landing  *(DONE 2026-06-03, commit 9705a73)*
`getSubtitleVariants()` now includes the "📍 Nearest to you · {hood}" variant
only when `currentFilter !== 'featured'` (browse views ARE distance-sorted;
curated featured landing is not). `updateLocationDisplay()` likewise gates its
GPS force-show to non-featured filters. SW bumped v1.17.0 → v1.18.0.

---

### [X] #24 — "Translate all" + "AI Review all" in editor Events tab  *(DONE 2026-06-03)*
- "Translate missing": scans all events for empty es/pt/fr, bundles in ONE
  Claude call, writes translations back. Skips already-translated events.
- "AI Review all": sends all events to Claude for keep/skip triage with one-line
  reasons. Session-only badges (green ✓ Keep / amber ⚠ Skip) — NOT stored in
  content.json, advisory only, clears on reload.
- "needs i18n" badge on each event row when any es/pt/fr field is empty.
- SW bumped v1.18.0 → v1.19.0.

---

### [X] #20 — Prod Secrets (ANTHROPIC_API_KEY + TICKETMASTER_KEY) not persisting  *(RESOLVED 2026-06-03)*
Two compounding causes:
1. WRONG VAR TYPE: keys set as plain-text variables (and/or Build tab). On a
   Worker, `wrangler deploy` (runs on every git push via Workers Builds) rebuilds
   bindings from wrangler.jsonc and WIPES dashboard plain-text vars not declared
   there → key vanished on push. Build-tab vars are build-time only.
   FIX: set both as encrypted SECRETS in Worker runtime "Variables and Secrets".
2. TICKETMASTER 401 (after above): pasted TM secret had trailing whitespace/newline;
   URLSearchParams encoded it as %0A → TM rejected it.
   FIX: re-paste the 32-char Consumer Key clean (no trailing newline).
VERIFIED: Anthropic auto-translate works in prod; survives git push.

---

### [X] #32 — Three passenger-facing strings never translated  *(FIXED 2026-06-01)*
Root cause: hardcoded English with NO data-key, so setLang()/applyStrings() never
touched them.
- "Your city guide" (sidebar header .app-sub) → added data-key="app.subtitle"
- "Language" (lang picker label .lang-label) → added data-key="app.language"
- "My Queen" (driver-page eyebrow) → hardcoded string; now `${q.eyebrow ? tx(q.eyebrow) : 'My Queen'}`
Added content.json: strings.app.{subtitle,language} + driver.queen.eyebrow (EN/ES/PT/FR).

---

### [X] #19 — RSS fetch creates old/past events  *(FIXED 2026-06-01)*
Root cause: decorateSoulOfMiami set item.date ONLY when it found an M/D/YYYY;
otherwise item kept its pubDate (the POST date, ~today) and masqueraded as current.
Fix (functions/api/rss-fetch.js):
1. decorateSoulOfMiami returns null when no parseable event date found.
2. New miamiToday() (America/New_York) + dropPastEvents() applied in onRequestGet
   as defense-in-depth. Helpers exported for unit testing.

---

### [X] #18 — Weather page shows "16 PM" instead of "4 PM"  *(FIXED 2026-05-31)*
Root cause: hourly-strip formatter kept the 24h number and appended am/pm
(h.hour.replace(':00','') + (hr<12?'am':'pm')) → 16:00 → "16pm".
Fix: convert to 12-hour — hr12 = hr24 % 12 === 0 ? 12 : hr24 % 12, with am/pm
from hr24<12. Guarded by tests/weather.spec.js.

---

### [X] #27 — Editor unreachable offline → raw Safari error  *(BUILT 2026-05-31)*
Root cause: sw.js NEVER_CACHE handler did `event.respondWith(fetch(event.request))`
with NO `.catch()`. Offline, fetch() rejects → respondWith gets rejected promise
→ "Safari can't open the page … FetchEvent.respondWith received an error".
Fix: NEVER_CACHE branch now wraps fetch() in `.catch()`. Document requests offline
→ inline OFFLINE_EDITOR_HTML (navy/teal/gold "Dashboard needs a connection" page +
Try again button); other never-cached requests → empty 503 the caller can handle.
SW bumped v1.11.0 → v1.12.0. Editor stays network-only (always fresh by design).

---

### [X] #16 — RSS event feeds wired  *(RESOLVED 2026-05-30)*
**The Soul of Miami** (soulofmiami.org/feed/) — valid RSS 2.0, ~50 items, one post
per event. decorateSoulOfMiami() lifts: event date (first M/D/YYYY in intro),
free flag ("Cost: Free" vs "Cost: $NN"), venue+addr.
Returns null for "Front Page …" digest posts so they're dropped.
Also: Ticketmaster Discovery API wired (ticketmaster-fetch.js); editor "Fetch
Ticketmaster" + "Re-fetch RSS" buttons. TM pulls size=100, collapses by name+venue
(keeps soonest), caps at MAX_EVENTS=25. Dedup within-batch by url.

---

### [X] #15 — Phone rendering fixed  *(DONE 2026-05-29)*
- Portrait phones: CSS-only #rotate-overlay ("Please rotate your phone", i18n).
  Gated @media (orientation: portrait) and (max-width: 500px).
- Landscape phones: @media (orientation: landscape) and (max-height: 480px) shrinks
  sidebar 220→176px, tightens paddings, hides footer tip/credit, makes sidebar
  scrollable.
- Kiosk (≥768px tablet) matches NEITHER — sidebar stays exactly 220px.

---

### [X] #14 — Rest / blackout mode  *(DONE 2026-05-29)*
- "Rest screen" button (moon icon) in sidebar — persistent across all tabs.
- enterRest(): pure-black full-screen overlay (z-index 120), gray Playfair clock
  (HH:MM + dim AM/PM, updates every 1s), dim "Tap anywhere to wake" hint.
- Inactivity flow suppressed while resting (restActive flag).
- Auto-WAKE: REST_MAX_MS = 600000 (10 min). After 10 min dark, autoWakeRest()
  wakes to a FRESH home view (new passenger assumption).
- 30s WARNING BOX before auto-wake: "Waking up in {n}s" countdown + "Keep it dark
  · 10 more min". Tapping the box re-arms a fresh 10-min cycle.

---

### [X] #13 — Rotating subtitle  *(DONE 2026-05-28)*
Greeting subtitle cycles through 5-6 variants every 15s with 250ms fade:
  📍 Nearest to you · {neighborhood}  (GPS-driven, only on browse views, not featured)
  🛟 Buckle up — Miami's waiting
  💡 Tap any place to see more
  🐶 Meet my crew on the driver page (conditional on bubbleVisible)
  ⭐ Today's pick: {venue name}
  🌴 Did you know? Miami has more Art Deco buildings…
Random starting index per page-load. GPS fires force-show of nearest variant.

---

### [X] #12 — Weather page UI — hourly vs weekly distinction  *(DONE 2026-05-29)*
- .section-eyebrow with icon + accent — clock for "Hourly · Today", calendar for
  "5-Day Forecast".
- Wrapped hourly strip in teal-tinted .hourly-panel so it reads as its own module.
- Fixed latent precedence bug in stale-label concat.

---

### [X] #11 — Resize fonts + emoji on Games page  *(DONE 2026-05-29)*
Single @media (min-height: 600px) block scales up all five games for the kiosk
(landscape phones ≤480px tall keep compact sizes). Also capped .game-body at
max-width 740px (centered) so options don't stretch across 1024px.

---

### [X] #10 — Toggle to show/hide "Meet your driver" bubble  *(DONE 2026-05-29)*
- editor.html: toggle "Show 'Meet your driver' on the passenger app" in Driver
  panel; saveDriver writes the boolean.
- index.html: renderDriver() sets #nav-driver display from flag; switchTab('driver')
  redirects to guide when hidden; subtitle rotator "meet my crew" variant gates on it.
- content.json: driver.bubbleVisible = true.

---

### [X] #9 — Analytics: reset + export + real dashboard  *(DONE 2026-05-30)*
Storage: IndexedDB 'MiamiRideAnalytics' (v1), stores 'sessions' + 'taps'. The
editor's old dashboard bars were HARDCODED PLACEHOLDERS — now reads real IndexedDB.
- openAnalyticsDB(): opens the same store index.html writes; never leaves a store-
  less DB that would break passenger logging.
- REAL stats: session count, avg duration, QR taps, tab engagement, top venues,
  language usage. Placeholders gone.
- RESET: "Reset analytics" (btn-danger) in Settings → confirm() → clears both stores.
- EXPORT: "Export analytics (JSON)" → analytics-YYYY-MM-DD.json with summary block.

---

### [X] #8 — Three Turkish restaurants added  *(DONE 2026-05-30)*
Added v009/v010/v011 to content.json:
- v009 El Turco — restaurant, $$$, Buena Vista. 5026 NE 2nd Ave. Michelin Bib Gourmand.
- v010 Doya — restaurant, $$$, Wynwood. 347 NW 24th St. Modern Aegean Greek+Turkish mezze.
- v011 Alaçatı — restaurant, $$, HALLANDALE BEACH (Broward, ~13 mi N of downtown).
  NOTE: not Aventura as originally guessed. GPS will sort it as a far venue.
All three: abdullahsPick=false, abdullahsNote=null — for Abdullah to personalize.

---

### [X] #6 — Event image extraction + gradient fallback  *(DONE 2026-05-30)*
Applied to EVENTS (not venues — no venue↔RSS join key). rss-fetch.js: extractImage()
tries media:thumbnail, media:content, enclosure, then first <img> in HTML.
ticketmaster-fetch.js: pickImage() prefers 16:9 ~640px, else widest.
index.html: buildEventCard renders .event-photo banner only when e.image is set;
broken URLs self-remove (onerror). CSS: 130px, cover, red→gold gradient + bottom scrim.

---

### [X] #4 — Remove dead buildHandymanCard() in index.html  *(DONE 2026-05-28)*
Function deleted; .handyman-* CSS classes deleted; openQR('handyman') branch deleted.

---

### [X] #5 — Remove "Handyman (legacy)" editor panel  *(DONE 2026-05-28)*
editor.html: nav-handyman item, panel-handyman block, renderHandyman(), saveHandyman(),
aiTranslateHandyman(), stat-handyman card all removed. content.json: ads.handyman block
removed (ads.sponsored stays). health.html: schema + handyman checks removed.

---

### [X] #3 — Delete mock files  *(DONE 2026-05-28)*
public/mock-driver.html and public/mock-homepage.html removed.
NOTE: design mocks now live permanently in mocks/ and helper scripts in scripts/ —
never delete them (Abdullah's policy set 2026-06-02).

---

### [X] #2 — Auto-translate for driver fields  *(DONE 2026-05-28)*
"Auto-translate to ES / PT / FR" card in Driver-page panel. aiTranslateDriver()
flattens all English driver fields into one keyed JSON object, single Claude call,
parses response, writes ES/PT/FR back into CONTENT in memory. NOT auto-persisted —
flow: Translate all → toast → Save driver data → Save & Publish.
callClaude() upgraded to accept { maxTokens }; driver translate uses 4000.

---

### [X] #1 — Real QR codes on driver page  *(DONE 2026-05-28)*
Inline 60x60 QRs via renderInlineQR(). Phone QR encodes vCard (FN+TEL) — iPhone
Camera offers "Add to Contacts". Thumbtack QR encodes CONTENT.driver.thumbtack.url.
Tapping either opens #qr-modal at 144px. openDriverQR() stub removed.

---

### [X] Multiplayer games a/b/c — Tic-tac-toe, Tap Duel, Trivia Buzzer  *(2026-06-01/02)*

**a) Tic-tac-toe (2P)** *(DONE 2026-06-01)*
Games page redesigned: replaced trivia-hero + 2x2 grid with "Solo" and "With friends"
categories, player-count badges, one-liners. P1=X (teal, LEFT), P2=O (gold, RIGHT),
same orientation (no 180° flip). Turn bar highlights active player; running win tally.
"Loser goes first" rule. 5 logic tests + 1 i18n test. SW v1.13.0 → v1.14.0.

**b) Tap-reaction duel (2-3P)** *(DONE 2026-06-02)*
2/3 zones. Arming=red → random 1.2-4.0s delay → all zones green → first valid tap wins.
False start (tap on red) = VOIDS the round and names the early tapper (no tally, fair
at any count). #game-duel; reset: initDuel.

**c) Multiplayer trivia buzzer (2-3P)** *(DONE 2026-06-02)*
Reuses TRIVIA_QUESTIONS. Shared question up top, per-player BUZZ buttons along bottom.
ANTI-EXPLOIT: buzz starts a 5s per-buzz countdown (BUZZ_SECONDS, visible #buzz-timer).
- Correct → +1, question ends.
- Wrong (in time) → locked out, no point lost; buzz reopens for others.
- Timeout → LOSE a point + locked out; buzz reopens.
- Scores MAY GO NEGATIVE (deliberate — keeps penalty biting).
- All players out → reveal answer, no winner, Next.
#game-buzzer; reset: initBuzzer. SW v1.15.0 → v1.16.0.

---

## Resolved Infrastructure Issues

### Prod Deploy Architecture Fix  *(2026-05-29)*
/api/* was 404ing in PRODUCTION. Root cause: this is a WORKERS project but was being
treated as Pages. `wrangler deploy` IGNORES Pages `functions/` auto-routing.
Fix: added src/index.js Worker entry routing /api/* to function modules + falling
through to env.ASSETS for static files. wrangler.jsonc gained "main": "src/index.js"
+ assets.binding "ASSETS". `npm run dev` switched to `wrangler dev` so local matches
prod. Verified /api/rss-fetch + /api/ticketmaster-fetch + /api/claude-proxy all work.

### GitHub PAT Leak  *(RESOLVED 2026-05-29)*
Token leaked in .git/config remote URL.
1. Token revoked at github.com/settings/tokens.
2. Token stripped: `git remote set-url origin https://github.com/.../miami-ride-companion.git`.
3. .gitignore verified (node_modules/, .dev.vars* already ignored).
For dashboard publish flow: generate a fresh fine-grained token (this repo only) and
store in browser localStorage — NEVER in the remote URL.

---

## Session Notes (for historical context)

### 2026-06-07 (sunday-sprint branch, merged)
Items #31, #26, #22, #35, #25, #29 (Tap Frenzy), #30d (Connect Four) shipped and
merged to main. SW bumps v1.26.1, v1.26.2.

### 2026-06-02/03 Session (PWA icons + Deco Dusk retheme)
**PWA ICONS**: created real icon-192.png + icon-512.png (were 404ing). 3 designs
mocked (A "Sunset Causeway", B "Drop Pin Palm", C "Miami Vice" purple/pink synthwave
palm). Abdullah chose C. Rendered via scripts/render-icons.mjs (sharp). Added to SW
PRECACHE_URLS. Note: sharp is a transitive dep, not in package.json — add as devDep
if icon scripts break after clean install.

**DECO DUSK RETHEME**: warm dark "South Beach art-deco at twilight" replacing the
cool navy/teal/gold light theme. Token-first approach — :root remapped, most
components flipped automatically. Fonts: Marcellus (display) + Poiret One (deco labels).
Greeting "welcome aboard" accented italic gold (.greeting-accent, injection-safe DOM nodes).
Surgical fixes: filter pills, hero gold deco frame, weather cards, event cards, ALL game
screens (EXCEPT QR backgrounds — must stay white to scan), trivia/word/image feedback
states, tap-duel/buzzer states, inactivity + QR modals. Verified via screenshots + audit
scripts. SW v1.16.0 → v1.17.0. OPEN: verify on real iPad — dark-screen glare in bright car
was the original reason the theme was light.

**MOCKS POLICY** (Abdullah, 2026-06-02): keep ALL design mocks permanently in mocks/ and
helper scripts in scripts/ — never delete as "cleanup".

### 2026-05-31 Session (translations, events, weather, tests)
- WEATHER FORECAST RAIL BUG: 5-day right rail showed previous day labelled "Today" +
  weekday labels one day early. Causes: (a) `new Date("YYYY-MM-DD")` parsed as UTC →
  prior day in Miami; now parseLocalDate(). (b) forecast[0] hard-labelled "Today"
  regardless of real date → drop past days, label "Today" only when date === todayStr().
- TRANSLATIONS: full pass filling every missing ES/PT/FR across all driver fields,
  subtitle variants, venue notes, events.
- EVENTS CURATION: removed 13 past events; fetched Soul of Miami (6) + Ticketmaster (14)
  locally via wrangler dev; curated to 12 high-value upcoming events. Geocoded event
  missing coords (Grove Cup → Peacock Park) via Nominatim.
- PLAYWRIGHT: suite grew 31 → 36. New tests/content.spec.js, tests/weather.spec.js.

### 2026-05-30 Deploy (commit d21195c)
Left-thumbnail event cards (blur backdrop, 2-line clamp); 11 new SoFlo venues (v012-v022:
nightlife Medium Cool/E11even/Club Space/LIV/DAER/Original Fat Cat's; attractions Riverwalk
Ft Lauderdale/Everglades Holiday Park; gems Flamingo Gardens/Butterfly World/Ichimura
Japanese Garden), EN/ES/PT/FR; configurable rest auto-wake (settings.restMinutes, default 5);
driver.queen "My Queen" line; editor GitHub owner/repo prefilled; SW v1.8.0.

### 2026-05-30 Deploy (commit 13ec4ba)
#6 event photos, #8 Turkish venues, #9 real analytics, #16 Soul of Miami feed, SoFlo event
radius, numeric-entity decode, SW v1.6.0. Verified: /api/rss-fetch returns Soul of Miami events.
