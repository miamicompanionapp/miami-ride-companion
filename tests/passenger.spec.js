// E2E: passenger-facing app (public/index.html) — the landscape tablet kiosk.
const { test, expect } = require('./fixtures');

test.describe('Passenger app', { tag: ['@index'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    // Home view is ready once the "more near you" minis have rendered.
    await page.waitForSelector('#gp-minis .gp-mini', { timeout: 10_000 });
  });

  test('loads the home view with a hero pick and venues', { tag: ['@smoke'] }, async ({ page }) => {
    await expect(page.locator('#gp-hero-slot')).not.toBeEmpty();
    expect(await page.locator('#gp-minis .gp-mini').count()).toBeGreaterThan(0);
    const venueCount = await page.evaluate(() => CONTENT.guide.venues.length);
    expect(venueCount).toBeGreaterThan(0);
  });

  test('featured landing: hero = featuredVenueId, minis = curated featuredMiniIds (hero excluded)', async ({ page }) => {
    const { heroId, miniIds, curated } = await page.evaluate(() => ({
      heroId: CONTENT.guide.featuredVenueId,
      miniIds: [...document.querySelectorAll('#gp-minis .gp-mini')].map(el => el.getAttribute('data-vid')),
      curated: CONTENT.guide.featuredMiniIds || [],
    }));
    // The hero never doubles as a mini.
    expect(miniIds).not.toContain(heroId);
    // Curated ids (minus the hero) lead the row, in order.
    const expected = curated.filter(id => id !== heroId).slice(0, 3);
    expect(miniIds.slice(0, expected.length)).toEqual(expected);
  });

  test('switches language across ES / PT / FR / EN', async ({ page }) => {
    const expected = {
      es: 'Guía de Ciudad',
      pt: 'Guia da Cidade',
      fr: 'Guide de la Ville',
      en: 'City Guide',
    };
    for (const [lang, label] of Object.entries(expected)) {
      await page.evaluate((l) => setLang(l), lang);
      await expect(page.locator('#nav-guide')).toContainText(label);
    }
  });

  test('browse filter shows cards and opens a venue detail sheet', async ({ page }) => {
    await page.evaluate(() => setFilter('restaurant'));
    const cards = page.locator('#cards-grid > *');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);

    await cards.first().click();
    await expect(page.locator('#venue-sheet')).toBeVisible();
    await expect(page.locator('#vs-name')).not.toBeEmpty();

    await page.evaluate(() => closeVenueSheet());
  });

  test('upcomingEvents() hides past events and sorts soonest-first', async ({ page }) => {
    // Guards the event date handling: past events drop out, future ones stay,
    // ordered nearest-first. Uses the app's own todayStr() so it is not
    // sensitive to the machine timezone.
    const res = await page.evaluate(() => {
      const t = todayStr();
      const shift = (days) => {
        const [y, m, d] = t.split('-').map(Number);
        const dt = new Date(y, m - 1, d + days);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      };
      const sample = [
        { id: 'past', date: shift(-3) },
        { id: 'soon', date: shift(2) },
        { id: 'today', date: t },
        { id: 'later', date: shift(10) },
      ];
      return upcomingEvents(sample).map((e) => e.id);
    });
    expect(res).not.toContain('past');
    expect(res).toEqual(['today', 'soon', 'later']);
  });

  test('published events are all upcoming (no past dates linger in content.json)', async ({ page }) => {
    const stale = await page.evaluate(() => {
      const t = todayStr();
      return (CONTENT.guide.events || []).filter((e) => e.date && e.date < t).map((e) => `${e.id} (${e.date})`);
    });
    expect(stale, `past events still published:\n${stale.join('\n')}`).toEqual([]);
  });

  test('weather tab renders forecast content', async ({ page }) => {
    await page.locator('#nav-weather').click();
    await expect(page.locator('#page-weather')).toHaveClass(/active/);
    await expect(page.locator('#weather-content')).not.toBeEmpty();
  });

  test('weather visually distinguishes hourly and 5-day sections', async ({ page }) => {
    await page.locator('#nav-weather').click();
    // Force a fresh reading so the hourly panel renders alongside the 5-day list.
    await page.evaluate(() => { CONTENT.weather.fetchedAt = new Date().toISOString(); renderWeather(); });
    await expect(page.locator('.hourly-panel')).toBeVisible();
    expect(await page.locator('.section-eyebrow').count()).toBe(2); // hourly + 5-day eyebrows
  });

  test('driver bubble hides (and tab is guarded) when bubbleVisible is false', async ({ page }) => {
    // Default ships hidden now, so force it on first to prove the visible state.
    await page.evaluate(() => { localStorage.removeItem('mrc_bubble'); CONTENT.driver.bubbleVisible = true; renderDriver(); });
    await expect(page.locator('#nav-driver')).toBeVisible();
    await page.evaluate(() => { CONTENT.driver.bubbleVisible = false; renderDriver(); });
    await expect(page.locator('#nav-driver')).toBeHidden();
    await page.evaluate(() => switchTab('driver')); // should be redirected to guide
    await expect(page.locator('#page-guide')).toHaveClass(/active/);
  });

  test('5-tap footer override forces the bubble on without touching content.json', async ({ page }) => {
    // Content default is hidden; the per-device override should win.
    await page.evaluate(() => { localStorage.removeItem('mrc_bubble'); CONTENT.driver.bubbleVisible = false; renderDriver(); });
    await expect(page.locator('#nav-driver')).toBeHidden();
    for (let i = 0; i < 5; i++) await page.locator('#bubble-toggle-zone').click();
    await expect(page.locator('#nav-driver')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('mrc_bubble'))).toBe('show');
    // Five more taps flips it back off and persists.
    for (let i = 0; i < 5; i++) await page.locator('#bubble-toggle-zone').click();
    await expect(page.locator('#nav-driver')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('mrc_bubble'))).toBe('hide');
  });

  test('games scale up to fill the kiosk canvas', { tag: ['@games'] }, async ({ page }) => {
    await page.locator('#nav-games').click();
    await page.evaluate(() => openGame('tap'));
    const circle = await page.locator('#tap-circle').evaluate(el => el.getBoundingClientRect().width);
    expect(circle, 'tap circle should be enlarged on the 768px-tall kiosk').toBeGreaterThanOrEqual(240);
  });

  test('driver page renders bio and pet crew', async ({ page }) => {
    await page.evaluate(() => { localStorage.setItem('mrc_bubble', 'show'); renderDriver(); switchTab('driver'); });
    await expect(page.locator('#page-driver')).toHaveClass(/active/);
    await expect(page.locator('#dp-bio-name')).not.toBeEmpty();
    await expect(page.locator('#dp-bio-paragraphs')).not.toBeEmpty();
    expect(await page.locator('#dp-pets-grid > *').count()).toBeGreaterThan(0);
  });

  test('QR modal opens and renders a scannable code', async ({ page }) => {
    await page.evaluate(() => openQR('app'));
    await expect(page.locator('#qr-modal')).toBeVisible();
    expect(await page.locator('#qr-code-container canvas, #qr-code-container img').count()).toBeGreaterThan(0);
    await page.evaluate(() => closeQR());
  });

  // Each game should open to its screen and close cleanly.
  for (const game of ['trivia', 'tap', 'word', 'spin', 'image', 'ttt', 'c4', 'duel', 'buzzer', 'wyr', 'ct']) {
    test(`game "${game}" opens and closes`, { tag: ['@games', '@smoke'] }, async ({ page }) => {
      await page.locator('#nav-games').click();
      await page.evaluate((g) => openGame(g), game);
      await expect(page.locator(`#game-${game}`)).toBeVisible();
      await page.evaluate(() => closeGame());
      await expect(page.locator(`#game-${game}`)).toBeHidden();
    });
  }

  test('advisory banner shows with active advisories (from content.json) and tapping it opens the overlay', async ({ page }) => {
    // This app's content.json currently carries real active beach advisories,
    // so no fixture injection needed — assert against the live banner state.
    const hasActive = await page.evaluate(() => getActiveAdvisories().length > 0);
    test.skip(!hasActive, 'no active advisories in content.json right now');
    await expect(page.locator('#advisory-banner')).toHaveClass(/visible/);
    await page.locator('#advisory-banner').click();
    await expect(page.locator('#advisories-overlay')).toHaveClass(/visible/);
    expect(await page.locator('.advisory-item').count()).toBeGreaterThan(0);
    await page.locator('.advisories-close').click();
    await expect(page.locator('#advisories-overlay')).not.toHaveClass(/visible/);
  });

  test('opening advisories logs a tap and a GA4 event tagged with its entry point (banner vs attractor)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const events = [];
      const origGtag = window.gtag;
      window.gtag = (cmd, name, params) => { if (cmd === 'event') events.push({ name, params }); };
      const origSessionTaps = { ...sessionTaps };

      openAdvisoriesOverlay('banner');
      closeAdvisoriesOverlay();
      openAdvisoriesOverlay('attractor');
      closeAdvisoriesOverlay();

      window.gtag = origGtag;
      const tapCount = sessionTaps['advisories_open'] || 0;
      Object.keys(sessionTaps).forEach(k => { if (!(k in origSessionTaps)) delete sessionTaps[k]; });
      return { events: events.filter(e => e.name === 'advisories_open'), tapCount };
    });
    expect(result.tapCount).toBe(2); // logTap fired for both opens
    expect(result.events.map(e => e.params.source)).toEqual(['banner', 'attractor']);
  });

  test('advisory banner is hidden when all advisories have expired', async ({ page }) => {
    await page.evaluate(() => {
      CONTENT.advisories = {
        fetchedAt: new Date().toISOString(),
        items: [{ id: 'x', expiresAt: new Date(Date.now() - 1000).toISOString(), title: { en: 't' }, detail: { en: 'd' } }],
      };
      renderAdvisories();
    });
    await expect(page.locator('#advisory-banner')).not.toHaveClass(/visible/);
  });

  test('advisories overlay lists active items with title, detail, and source', async ({ page }) => {
    await page.evaluate(() => {
      CONTENT.advisories = {
        fetchedAt: new Date().toISOString(),
        items: [{
          id: 'test_beach', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          title: { en: 'Test Beach — Water Quality Advisory' },
          detail: { en: 'Elevated bacteria detected.' },
          source: 'Florida Dept. of Health — Healthy Beaches',
          sourceUrl: 'https://www.floridahealthybeaches.com/county/dade/beach/test-beach',
          effectiveAt: '7/8/2026',
        }],
      };
      renderAdvisories();
      openAdvisoriesOverlay();
    });
    await expect(page.locator('.advisory-item-title')).toHaveText('Test Beach — Water Quality Advisory');
    await expect(page.locator('.advisory-item-detail')).toHaveText('Elevated bacteria detected.');
    await expect(page.locator('.advisory-item-source')).toContainText('Florida Dept. of Health');
    await page.evaluate(() => closeAdvisoriesOverlay());
  });
});
