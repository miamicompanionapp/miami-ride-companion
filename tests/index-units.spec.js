// Unit tests for the passenger app's pure/helper functions (public/index.html).
// These run in-browser via page.evaluate (the functions live on the global
// scope of a plain <script>), which keeps the monolithic single-file design
// intact — no extraction, no build step. Behavioral E2E flows live in
// passenger.spec.js; this file is the fine-grained logic layer.
//
// Tags: @index @unit  →  `npm run test:index` covers the whole passenger app.
//
// Uses the base @playwright/test runner (not ./fixtures): these assert pure
// function OUTPUTS, so an unrelated background CDN/resource blip must not fail
// them. The strict console-error fixture stays on the E2E flow specs, where
// silent breakage is what we're hunting.
const { test, expect } = require('@playwright/test');

test.describe('Index units: helpers', { tag: ['@index', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof haversine === 'function' && typeof CONTENT !== 'undefined');
  });

  test('haversine: 0 for identical points, ~69 mi per degree of latitude', async ({ page }) => {
    const { same, oneDeg } = await page.evaluate(() => ({
      same: haversine(25.0, -80.0, 25.0, -80.0),
      oneDeg: haversine(25.0, -80.0, 26.0, -80.0),
    }));
    expect(same).toBe(0);
    expect(oneDeg).toBeGreaterThan(68);
    expect(oneDeg).toBeLessThan(70);
  });

  test('formatPhone: normalizes 10- and 11-digit numbers', async ({ page }) => {
    const out = await page.evaluate(() => [
      formatPhone('+1-786-919-2115'),
      formatPhone('7869192115'),
      formatPhone('786-919-2115'),
    ]);
    expect(out).toEqual(['(786) 919-2115', '(786) 919-2115', '(786) 919-2115']);
  });

  test('@negative formatPhone: returns the input unchanged when it is not 10/11 digits', async ({ page }) => {
    const out = await page.evaluate(() => [formatPhone('12345'), formatPhone('not a phone'), formatPhone('')]);
    expect(out).toEqual(['12345', 'not a phone', '']);
  });

  test('buildVCard: emits a valid vCard with digits-only TEL', async ({ page }) => {
    const card = await page.evaluate(() => buildVCard({ name: 'Abdullah', phone: '(786) 919-2115' }));
    expect(card.split('\r\n')).toEqual(['BEGIN:VCARD', 'VERSION:3.0', 'FN:Abdullah', 'TEL:7869192115', 'END:VCARD']);
  });

  test('@negative buildVCard: omits FN/TEL lines when name/phone are missing', async ({ page }) => {
    const card = await page.evaluate(() => buildVCard({}));
    expect(card.split('\r\n')).toEqual(['BEGIN:VCARD', 'VERSION:3.0', 'END:VCARD']);
  });

  test('petEmoji: maps known species, falls back to paw print', async ({ page }) => {
    const out = await page.evaluate(() => [petEmoji('cat'), petEmoji('Dog'), petEmoji('PUG'), petEmoji('iguana'), petEmoji('')]);
    expect(out).toEqual(['🐱', '🐶', '🐶', '🐾', '🐾']);
  });

  test('capitalize: uppercases the first letter; empty-safe', async ({ page }) => {
    const out = await page.evaluate(() => [capitalize('restaurant'), capitalize('a'), capitalize('')]);
    expect(out).toEqual(['Restaurant', 'A', '']);
  });

  test('fullResImage: strips a -WxH thumbnail suffix, preserving extension + query', async ({ page }) => {
    const out = await page.evaluate(() => [
      fullResImage('https://cdn.com/photo-640x480.jpg'),
      fullResImage('https://cdn.com/photo-1024x768.png?v=2'),
      fullResImage('https://cdn.com/photo.jpg'),
    ]);
    expect(out).toEqual([
      'https://cdn.com/photo.jpg',
      'https://cdn.com/photo.png?v=2',
      'https://cdn.com/photo.jpg',
    ]);
  });

  test('parseLocalDate: parses YYYY-MM-DD as a LOCAL date (no UTC off-by-one)', async ({ page }) => {
    const parts = await page.evaluate(() => {
      const d = parseLocalDate('2026-05-30');
      return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() };
    });
    expect(parts).toEqual({ y: 2026, m: 4, day: 30 }); // month is 0-indexed
  });

  test('detectNeighborhood: resolves known zones', async ({ page }) => {
    const out = await page.evaluate(() => [
      detectNeighborhood(25.78, -80.13),  // South Beach
      detectNeighborhood(25.80, -80.198), // Wynwood
    ]);
    expect(out).toEqual(['South Beach', 'Wynwood']);
  });

  test('@negative detectNeighborhood: falls back to "Miami, FL" outside all zones', async ({ page }) => {
    expect(await page.evaluate(() => detectNeighborhood(0, 0))).toBe('Miami, FL');
  });
});

test.describe('Index units: map tile-failure warning copy', { tag: ['@index', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof setMapZoomWarning === 'function');
  });

  // setMapZoomWarning() decides which copy to show for a failed tile: 'zoom' (deep
  // zoom beyond the offline pre-cache max — zooming out is the real fix) vs 'range'
  // (panned outside the downloaded area — zooming out wouldn't help). Exercised
  // directly on the DOM node so this doesn't depend on a live Leaflet map or real
  // tile network traffic.
  test('setMapZoomWarning: "zoom" kind shows the zoom-out message', async ({ page }) => {
    const out = await page.evaluate(() => {
      setMapZoomWarning(true, 'zoom');
      return {
        visible: document.getElementById('map-zoom-warning').classList.contains('visible'),
        text: document.getElementById('map-zoom-warning-text').textContent,
      };
    });
    expect(out).toEqual({ visible: true, text: 'Zoom out for map tiles' });
  });

  test('setMapZoomWarning: "range" kind shows the outside-download-area message, not zoom-out', async ({ page }) => {
    const out = await page.evaluate(() => {
      setMapZoomWarning(true, 'range');
      return {
        visible: document.getElementById('map-zoom-warning').classList.contains('visible'),
        text: document.getElementById('map-zoom-warning-text').textContent,
      };
    });
    expect(out).toEqual({ visible: true, text: 'Outside downloaded map area' });
  });

  test('@negative setMapZoomWarning: hides without touching the last-shown copy', async ({ page }) => {
    const out = await page.evaluate(() => {
      setMapZoomWarning(true, 'range');
      setMapZoomWarning(false);
      return document.getElementById('map-zoom-warning').classList.contains('visible');
    });
    expect(out).toBe(false);
  });
});

test.describe('Index units: localization helpers', { tag: ['@index', '@unit', '@i18n'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof tx === 'function' && typeof CONTENT !== 'undefined');
  });

  test('tx: returns the active language, falls back to en, empty-safe', async ({ page }) => {
    const out = await page.evaluate(() => {
      const o = { en: 'Hello', es: 'Hola', pt: 'Olá', fr: 'Bonjour' };
      setLang('es');
      const es = tx(o);
      setLang('en');
      return { es, en: tx(o), fallback: tx({ en: 'OnlyEn' }), str: tx('passthrough'), nil: tx(null) };
    });
    expect(out).toEqual({ es: 'Hola', en: 'Hello', fallback: 'OnlyEn', str: 'passthrough', nil: '' });
  });

  test('@negative t: returns the key itself for an unknown string path', async ({ page }) => {
    const out = await page.evaluate(() => t('nope.not.a.real.key'));
    expect(out).toBe('nope.not.a.real.key');
  });
});

test.describe('Index units: featured / subtitle selection', { tag: ['@index', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof pickFeaturedVenue === 'function' && !!CONTENT.guide);
  });

  test('pickFeaturedVenue: resolves the configured featured venue', async ({ page }) => {
    const ok = await page.evaluate(() => {
      const v = pickFeaturedVenue();
      return !!v && v.id === CONTENT.guide.featuredVenueId;
    });
    expect(ok).toBe(true);
  });

  test('@negative pickFeaturedVenue: returns null when no featured/pick venue resolves', async ({ page }) => {
    const out = await page.evaluate(() => {
      const saved = { fid: CONTENT.guide.featuredVenueId, venues: CONTENT.guide.venues };
      CONTENT.guide.featuredVenueId = 'does-not-exist';
      CONTENT.guide.venues = CONTENT.guide.venues.map((v) => ({ ...v, abdullahsPick: false }));
      const res = pickFeaturedVenue();
      CONTENT.guide.featuredVenueId = saved.fid;
      CONTENT.guide.venues = saved.venues;
      return res;
    });
    expect(out).toBeNull();
  });

  test('getSubtitleVariants: includes a featured-venue variant when one resolves', async ({ page }) => {
    const count = await page.evaluate(() => getSubtitleVariants().length);
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

test.describe('Index units: event distance', { tag: ['@index', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof eventDistStr === 'function');
  });

  test('eventDistStr: formats distance once a location and coords are known', async ({ page }) => {
    const out = await page.evaluate(() => {
      userLat = 25.78; userLng = -80.19;
      return {
        here: eventDistStr({ lat: 25.78, lng: -80.19 }),
        far: eventDistStr({ lat: 26.78, lng: -80.19 }), // ~69 mi → rounded, no decimal
      };
    });
    expect(out.here).toBe(' · 0.0 mi');
    expect(out.far).toMatch(/^ · \d+ mi$/);
  });

  test('@negative eventDistStr: empty when location or coords are missing', async ({ page }) => {
    const out = await page.evaluate(() => {
      userLat = null; userLng = null;
      const noLoc = eventDistStr({ lat: 25.78, lng: -80.19 });
      userLat = 25.78; userLng = -80.19;
      const noCoords = eventDistStr({ venue: 'Somewhere' });
      return { noLoc, noCoords };
    });
    expect(out.noLoc).toBe('');
    expect(out.noCoords).toBe('');
  });
});

test.describe('Index units: venue sheet guards', { tag: ['@index', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForSelector('#gp-minis .gp-mini', { timeout: 10_000 });
  });

  test('@negative openVenueSheet: a bad id is a no-op (sheet stays closed)', async ({ page }) => {
    await page.evaluate(() => openVenueSheet('not-a-real-venue'));
    await expect(page.locator('#venue-sheet')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => currentVenueId)).toBeNull();
  });
});

test.describe('Index units: distance color tiers', { tag: ['@index', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof distClass === 'function');
  });

  // Coverage spans South Miami → Broward, so badges are colored green (near) /
  // gold (mid) / red (far). Thresholds: ≤6 near, ≤12 mid, >12 far. Guards the
  // boundaries so a tweak to the cutoffs is a deliberate, visible change.
  test('distClass: green/gold/red by mileage, boundaries inclusive on the low side', async ({ page }) => {
    const out = await page.evaluate(() => [
      distClass(0), distClass(6), distClass(6.01),
      distClass(12), distClass(12.01), distClass(25),
    ]);
    expect(out).toEqual([
      'dist-near', 'dist-near', 'dist-mid',
      'dist-mid', 'dist-far', 'dist-far',
    ]);
  });

  test('@negative distClass: empty string when distance is null/undefined', async ({ page }) => {
    const out = await page.evaluate(() => [distClass(null), distClass(undefined)]);
    expect(out).toEqual(['', '']);
  });
});

test.describe('Index units: attractor copy honesty', { tag: ['@index', '@unit', '@i18n'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof buildContentCards === 'function' && !!CONTENT.guide);
  });

  // The venue pool reaches well beyond Miami (nightlife → Fort Lauderdale,
  // attractions → the Everglades), so those two cards must NOT promise "Miami"
  // in any language — a passenger took the literal "Miami" label as a broken
  // promise. Regional framing only. (Events/weather/trivia legitimately stay
  // Miami and are intentionally excluded.)
  test('nightlife & attractions cards never say "Miami" in any language', async ({ page }) => {
    const offenders = await page.evaluate(() => {
      const cards = buildContentCards().filter((c) => c.id === 'nightlife' || c.id === 'attractions');
      const hits = [];
      for (const c of cards) {
        for (const lang of ['en', 'es', 'pt', 'fr']) {
          if (/miami/i.test(c.headline[lang] || '')) hits.push(`${c.id}.headline.${lang}`);
          if (/miami/i.test(c.sub[lang] || ''))      hits.push(`${c.id}.sub.${lang}`);
        }
      }
      return hits;
    });
    expect(offenders).toEqual([]);
  });

  test('nightlife card carries the South Florida framing in English', async ({ page }) => {
    const headline = await page.evaluate(
      () => buildContentCards().find((c) => c.id === 'nightlife').headline.en
    );
    expect(headline).toBe('South Florida nightlife');
  });
});

test.describe('Index units: handyman attractor card', { tag: ['@index', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof buildContentCards === 'function' && !!CONTENT.guide);
    // Make bubble visible by default so the handyman card appears in the pool
    await page.evaluate(() => { window.isBubbleVisible = () => true; });
  });

  test('handyman card exists in pool when bubble is visible, absent when hidden', async ({ page }) => {
    const result = await page.evaluate(() => {
      const orig = window.isBubbleVisible;
      window.isBubbleVisible = () => true;
      const cardVisible = buildContentCards().find(c => c.id === 'handyman');
      window.isBubbleVisible = () => false;
      const cardHidden = buildContentCards().find(c => c.id === 'handyman');
      window.isBubbleVisible = orig;
      return {
        foundWhenVisible: !!cardVisible,
        visual:           cardVisible?.visual,
        hasAction:        typeof cardVisible?.action === 'function',
        foundWhenHidden:  !!cardHidden,
      };
    });
    expect(result.foundWhenVisible).toBe(true);
    expect(result.visual).toBe('🔧');
    expect(result.hasAction).toBe(true);
    expect(result.foundWhenHidden).toBe(false);
  });

  test('handyman card has non-empty headline and sub in all 4 languages', async ({ page }) => {
    const missing = await page.evaluate(() => {
      const card = buildContentCards().find(c => c.id === 'handyman');
      const gaps = [];
      for (const lang of ['en', 'es', 'pt', 'fr']) {
        if (!card?.headline?.[lang]) gaps.push(`headline.${lang}`);
        if (!card?.sub?.[lang])      gaps.push(`sub.${lang}`);
      }
      return gaps;
    });
    expect(missing).toEqual([]);
  });

  test('handyman card sub contains a line break for the service list', async ({ page }) => {
    const subEn = await page.evaluate(
      () => buildContentCards().find(c => c.id === 'handyman').sub.en
    );
    expect(subEn).toContain('\n');
  });

  test('handyman card action navigates to the driver tab', async ({ page }) => {
    await page.evaluate(() => {
      // isBubbleVisible() guards switchTab('driver') — stub it so the tab switch lands
      window._origBubbleVisible = window.isBubbleVisible;
      window.isBubbleVisible = () => true;
      buildContentCards().find(c => c.id === 'handyman').action();
      window.isBubbleVisible = window._origBubbleVisible;
    });
    await expect(page.locator('#page-driver')).toHaveClass(/active/);
  });

  test('handyman card is boosted: appears multiple times per cycle like feedback', async ({ page }) => {
    // Page is fresh from beforeEach (attractorInCycle=0, attractorContentShuffled=[])
    // Walk enough cards to span one full cycle then stop.
    const counts = await page.evaluate(() => {
      window.isBubbleVisible = () => true;
      const cards = [];
      // A cycle is 1 lang card + up to ~25 content cards — 40 is a safe upper bound
      for (let i = 0; i < 40; i++) {
        const c = getNextAttractorCard();
        // attractorInCycle resets to 0 after every cycle; break when it wraps (i>0)
        // We can't read the let variable directly, so detect a second lang card
        if (i > 0 && (c.id === 'lang_es' || c.id === 'lang_pt' || c.id === 'lang_fr')) break;
        cards.push(c.id);
      }
      return {
        handyman: cards.filter(id => id === 'handyman').length,
        feedback: cards.filter(id => id === 'feedback').length,
        total: cards.length,
      };
    });
    // Both boosted cards should appear more than once per cycle
    expect(counts.handyman).toBeGreaterThan(1);
    expect(counts.feedback).toBeGreaterThan(1);
  });

  test('c4 attractor card puts the circle emoji pair on its own line', async ({ page }) => {
    const subs = await page.evaluate(() => {
      const card = buildContentCards().find(c => c.id === 'c4');
      return card?.sub;
    });
    for (const lang of ['en', 'es', 'pt', 'fr']) {
      expect(subs[lang]).toMatch(/\n🔴🟡$/);
    }
  });
});

test.describe('Index units: lang-section pulse on attractor dismiss', { tag: ['@index', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof hideAttractor === 'function');
  });

  test('hideAttractor adds pulsing class to .lang-section', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('attractor-overlay').classList.add('visible');
      hideAttractor();
    });
    await expect(page.locator('.lang-section')).toHaveClass(/pulsing/);
  });

  test('pulsing animation fires exactly once, not multiple flashes', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('attractor-overlay').classList.add('visible');
      hideAttractor();
    });
    const iterationCount = await page.locator('.lang-section').evaluate(
      el => getComputedStyle(el).animationIterationCount
    );
    expect(iterationCount).toBe('1');
  });
});

test.describe('Index units: advisories expiry + attractor card', { tag: ['@index', '@unit'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pwa-bypass', '1'));
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof getActiveAdvisories === 'function' && !!CONTENT.guide);
  });

  test('getActiveAdvisories filters out items past their expiresAt, keeps items not yet expired', async ({ page }) => {
    const result = await page.evaluate(() => {
      const orig = CONTENT.advisories;
      const now = Date.now();
      CONTENT.advisories = {
        fetchedAt: new Date().toISOString(),
        items: [
          { id: 'expired',  expiresAt: new Date(now - 1000).toISOString() },
          { id: 'active',   expiresAt: new Date(now + 60 * 60 * 1000).toISOString() },
          { id: 'no-expiry' }, // malformed/missing expiresAt must not be shown
        ],
      };
      const active = getActiveAdvisories().map(a => a.id);
      CONTENT.advisories = orig;
      return active;
    });
    expect(result).toEqual(['active']);
  });

  test('getActiveAdvisories returns an empty array when CONTENT.advisories is absent', async ({ page }) => {
    const result = await page.evaluate(() => {
      const orig = CONTENT.advisories;
      delete CONTENT.advisories;
      const active = getActiveAdvisories();
      CONTENT.advisories = orig;
      return active;
    });
    expect(result).toEqual([]);
  });

  test('advisories attractor card only appears in the pool while an advisory is active', async ({ page }) => {
    const result = await page.evaluate(() => {
      const orig = CONTENT.advisories;
      CONTENT.advisories = { fetchedAt: new Date().toISOString(), items: [] };
      const withoutAdvisory = buildContentCards().some(c => c.id === 'advisories');
      CONTENT.advisories = {
        fetchedAt: new Date().toISOString(),
        items: [{ id: 'x', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }],
      };
      const withAdvisory = buildContentCards().find(c => c.id === 'advisories');
      CONTENT.advisories = orig;
      return {
        withoutAdvisory,
        foundWithAdvisory: !!withAdvisory,
        hasAction: typeof withAdvisory?.action === 'function',
      };
    });
    expect(result.withoutAdvisory).toBe(false);
    expect(result.foundWithAdvisory).toBe(true);
    expect(result.hasAction).toBe(true);
  });

  test('advisories attractor card headline/sub carry all 4 languages, with {n} interpolated', async ({ page }) => {
    const result = await page.evaluate(() => {
      const orig = CONTENT.advisories;
      CONTENT.advisories = {
        fetchedAt: new Date().toISOString(),
        items: [
          { id: 'a', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
          { id: 'b', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
        ],
      };
      const card = buildContentCards().find(c => c.id === 'advisories');
      CONTENT.advisories = orig;
      return card ? { headline: card.headline, sub: card.sub } : null;
    });
    for (const lang of ['en', 'es', 'pt', 'fr']) {
      expect(result.headline[lang]).toBeTruthy();
      expect(result.sub[lang]).toBeTruthy();
      expect(result.sub[lang]).not.toContain('{n}');
      expect(result.sub[lang]).toContain('2');
    }
  });
});
