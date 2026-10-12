// E2E tests for the Spotify Jam guide: the 'spotify' attractor card, the
// sidebar "Play your music" button, the 3-step guide modal, its 30s
// auto-close (attractor entry only), translations, and tap analytics.
//
// Uses ./fixtures (strict console-error gate) for flow tests.
// Tags: @index @jam
const { test, expect } = require('./fixtures');

async function tapKeys(page) {
  return page.evaluate(() => new Promise(resolve => {
    const out = [];
    const cur = db.transaction('taps', 'readonly').objectStore('taps').openCursor();
    cur.onsuccess = e => { const c = e.target.result; if (c) { out.push(c.value.key); c.continue(); } else resolve(out); };
  }));
}

async function ready(page) {
  await page.waitForFunction(
    () => typeof openJamGuide === 'function' && CONTENT !== null && db !== null,
    { timeout: 10_000 }
  );
}

test.describe('Spotify Jam guide', { tag: ['@index', '@jam'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await ready(page);
  });

  test('spotify attractor card shows Spotify icon, new copy and a CTA pill', async ({ page }) => {
    await page.evaluate(() => renderAttractorCard(buildContentCards().find(c => c.id === 'spotify')));
    await expect(page.locator('#attractor-visual .ti-brand-spotify')).toHaveCount(1);
    await expect(page.locator('#attractor-headline')).toHaveText('Be the DJ on this ride');
    await expect(page.locator('#attractor-sub')).toContainText('Jam');
    await expect(page.locator('#attractor-cta')).toBeVisible();
    await expect(page.locator('#attractor-cta')).toHaveText(/Tap to see how/);
    // CTA is hidden again for a card without one
    await page.evaluate(() => renderAttractorCard(buildContentCards().find(c => c.id !== 'spotify' && !c.cta)));
    await expect(page.locator('#attractor-cta')).toBeHidden();
  });

  test('tapping the spotify attractor card opens the guide with a running countdown', async ({ page }) => {
    await page.evaluate(() => {
      showAttractor();
      renderAttractorCard(buildContentCards().find(c => c.id === 'spotify'));
    });
    await page.locator('#attractor-card').click();
    await expect(page.locator('#attractor-overlay')).not.toHaveClass(/visible/);
    await expect(page.locator('#jam-modal')).toHaveClass(/visible/);
    await expect(page.locator('#jam-countdown')).toHaveClass(/running/);
    await expect(page.locator('#jam-title')).toHaveText('Join the Jam in 3 steps');
    await expect(page.locator('#jam-needs')).toContainText('free account works');
    expect(await tapKeys(page)).toContain('attractor_spotify');
  });

  test('sidebar button opens the guide without a countdown, Got it closes it', async ({ page }) => {
    await expect(page.locator('#jam-btn')).toBeVisible();
    await page.locator('#jam-btn').click();
    await expect(page.locator('#jam-modal')).toHaveClass(/visible/);
    await expect(page.locator('#jam-countdown')).not.toHaveClass(/running/);
    await page.locator('#jam-close').click();
    await expect(page.locator('#jam-modal')).not.toHaveClass(/visible/);
    const keys = await tapKeys(page);
    expect(keys).toContain('jam_open_sidebar');
    expect(keys).toContain('jam_close');
  });

  test('tapping the backdrop closes the guide, tapping inside the box does not', async ({ page }) => {
    await page.evaluate(() => openJamGuide('sidebar'));
    await page.locator('#jam-s2d').click();
    await expect(page.locator('#jam-modal')).toHaveClass(/visible/);
    await page.mouse.click(5, 5);
    await expect(page.locator('#jam-modal')).not.toHaveClass(/visible/);
  });

  test('idle attractor closes an open guide', async ({ page }) => {
    await page.evaluate(() => openJamGuide('sidebar'));
    await page.evaluate(() => showAttractor());
    await expect(page.locator('#jam-modal')).not.toHaveClass(/visible/);
  });
});

test.describe('Spotify Jam guide: auto-close', { tag: ['@index', '@jam'] }, () => {
  test('attractor-opened guide auto-closes after 30s; sidebar-opened one stays', async ({ page }) => {
    await page.clock.install();
    await page.goto('/index.html');
    await ready(page);

    await page.evaluate(() => openJamGuide('attractor'));
    await page.clock.runFor(29_000);
    await expect(page.locator('#jam-modal')).toHaveClass(/visible/);
    await page.clock.runFor(1_500);
    await expect(page.locator('#jam-modal')).not.toHaveClass(/visible/);
    // Auto-close is not a passenger action — no jam_close tap
    expect(await tapKeys(page)).not.toContain('jam_close');

    // Sidebar guide outlives the normal idle delay (content.json attractorDelay=30s)…
    await page.evaluate(() => openJamGuide('sidebar'));
    await page.clock.runFor(60_000);
    await expect(page.locator('#jam-modal')).toHaveClass(/visible/);
    await expect(page.locator('#attractor-overlay')).not.toHaveClass(/visible/);
    // …but the idle flow still takes over after JAM_GUIDE_IDLE_MS (2 min)
    await page.clock.runFor(61_000);
    await expect(page.locator('#jam-modal')).not.toHaveClass(/visible/);
    await expect(page.locator('#attractor-overlay')).toHaveClass(/visible/);
  });
});

test.describe('Spotify Jam guide: translations', { tag: ['@index', '@jam', '@i18n'] }, () => {
  test('every Jam string and the card copy exist in all 4 languages', async ({ page }) => {
    await page.goto('/index.html');
    await ready(page);
    const missing = await page.evaluate(() => {
      const out = [];
      const card = buildContentCards().find(c => c.id === 'spotify');
      const objs = { ...JAM_STRINGS, cardHeadline: card.headline, cardSub: card.sub, cardCta: card.cta };
      for (const [k, o] of Object.entries(objs))
        for (const l of ['en', 'es', 'pt', 'fr']) if (!o[l]) out.push(k + '.' + l);
      return out;
    });
    expect(missing).toEqual([]);
  });

  test('switching language re-renders the sidebar button and guide', async ({ page }) => {
    await page.goto('/index.html');
    await ready(page);
    await page.evaluate(() => setLang('es'));
    await expect(page.locator('#jam-btn-title')).toHaveText('Pon tu música');
    await page.evaluate(() => openJamGuide('sidebar'));
    await expect(page.locator('#jam-title')).toHaveText('Únete a la Jam en 3 pasos');
    await expect(page.locator('#jam-close')).toHaveText('Entendido');
    await page.evaluate(() => setLang('fr'));
    await expect(page.locator('#jam-title')).toHaveText('Rejoignez la Jam en 3 étapes');
  });
});
