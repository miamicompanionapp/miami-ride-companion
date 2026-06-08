# Miami Ride Companion — Archive

Completed items, resolved bugs, historical session notes, and past decisions.
Read this for context on why things are the way they are; not for daily work.

---

## Completed Items

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
