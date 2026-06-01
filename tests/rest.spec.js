// E2E: Rest / blackout screen (passenger comfort feature).
const { test, expect } = require('./fixtures');

test.describe('Rest screen', { tag: ['@index', '@rest'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('#gp-minis .gp-mini', { timeout: 10_000 });
  });

  test('enters a black clock screen and wakes on tap', async ({ page }) => {
    await page.locator('.rest-btn').click();
    const screen = page.locator('#rest-screen');
    // The overlay fades via opacity (not display:none), so assert on the
    // `visible` class rather than toBeVisible/toBeHidden.
    await expect(screen).toHaveClass(/visible/);
    await expect(screen).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(page.locator('#rest-clock')).not.toBeEmpty();
    await expect(page.locator('#rest-hint')).not.toBeEmpty();

    await screen.click({ position: { x: 200, y: 200 } });
    await expect(screen).not.toHaveClass(/visible/);
  });

  test('translates the wake hint into Spanish', async ({ page }) => {
    await page.evaluate(() => setLang('es'));
    await page.locator('.rest-btn').click();
    await expect(page.locator('#rest-hint')).toContainText('Toca en cualquier lugar');
  });

  test('a manual tap-wake resumes the current tab (no reset)', async ({ page }) => {
    await page.locator('#nav-games').click();
    await page.locator('.rest-btn').click();
    await expect(page.locator('#rest-screen')).toHaveClass(/visible/);
    await page.locator('#rest-screen').click({ position: { x: 150, y: 150 } });
    await expect(page.locator('#page-games')).toHaveClass(/active/);
  });

  test('shows the warning box with a countdown before auto-wake', async ({ page }) => {
    // Jump straight to the warning instead of waiting ~9.5 min.
    await page.evaluate(() => { enterRest(); clearTimeout(restWarnTimer); showRestWarning(); });
    await expect(page.locator('#rest-warn')).toBeVisible();
    await expect(page.locator('#rest-warn-count')).toContainText(/\d+s/);
    await expect(page.locator('.rest-warn-extend')).toContainText('Keep it dark');
  });

  test('tapping the warning box extends the rest and hides the warning', async ({ page }) => {
    await page.evaluate(() => { enterRest(); clearTimeout(restWarnTimer); showRestWarning(); });
    await expect(page.locator('#rest-warn')).toBeVisible();

    await page.locator('#rest-warn').click();
    await expect(page.locator('#rest-warn')).toBeHidden();              // warning dismissed
    await expect(page.locator('#rest-screen')).toHaveClass(/visible/);  // still resting
    expect(await page.evaluate(() => restActive)).toBe(true);
  });

  test('auto-wakes to a fresh home view when the countdown completes', async ({ page }) => {
    await page.evaluate(() => switchTab('games'));
    // Enter rest, jump to the warning, and fast-forward the countdown to its last tick.
    await page.evaluate(() => {
      enterRest();
      clearTimeout(restWarnTimer);
      showRestWarning();
      restWarnVal = 1; // next 1s tick hits 0 → autoWakeRest()
    });
    await expect(page.locator('#rest-screen')).not.toHaveClass(/visible/, { timeout: 3000 });
    expect(await page.evaluate(() => restActive)).toBe(false);
    await expect(page.locator('#page-guide')).toHaveClass(/active/); // reset to home
  });
});
