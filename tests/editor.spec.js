// E2E: driver dashboard (public/editor.html) — PIN-protected, never cached.
const { test, expect } = require('./fixtures');

const PANELS = ['analytics', 'venues', 'events', 'weather', 'driver', 'sponsored', 'settings'];

async function unlock(page) {
  await page.fill('#auth-input', '1234'); // default PIN per CLAUDE.md
  await page.click('.auth-btn');
  await expect(page.locator('#auth-screen')).toBeHidden();
}

test.describe('Driver dashboard', { tag: ['@editor'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor.html');
    await page.waitForSelector('#auth-screen');
  });

  test('rejects an incorrect PIN', { tag: ['@negative'] }, async ({ page }) => {
    await page.fill('#auth-input', '0000');
    await page.click('.auth-btn');
    await expect(page.locator('#auth-screen')).toBeVisible(); // still locked
  });

  test('unlocks with the default PIN', async ({ page }) => {
    await unlock(page);
    await expect(page.locator('.shell')).toBeVisible();
  });

  test('renders every panel with content', async ({ page }) => {
    await unlock(page);
    for (const panel of PANELS) {
      await page.evaluate((id) => showPanel(id), panel);
      await expect(page.locator(`#panel-${panel}`)).toHaveClass(/active/);
      const text = (await page.locator(`#panel-${panel}`).innerText()).trim();
      expect(text.length, `panel "${panel}" should have content`).toBeGreaterThan(10);
    }
  });

  test('events panel offers Ticketmaster, RSS, and MBCC fetch sources', async ({ page }) => {
    await unlock(page);
    await page.evaluate(() => showPanel('events'));
    await expect(page.locator('#panel-events').getByRole('button', { name: /Ticketmaster/i })).toBeVisible();
    await expect(page.locator('#panel-events').getByRole('button', { name: /RSS/i })).toBeVisible();
    await expect(page.locator('#panel-events').getByRole('button', { name: /MBCC/i })).toBeVisible();
    // The fetch wrappers must exist (wired to the Pages Functions).
    expect(await page.evaluate(() =>
      typeof fetchTicketmaster === 'function' && typeof fetchEvents === 'function' && typeof fetchMbcc === 'function'
    )).toBe(true);
  });

  test('driver panel has the show-bubble toggle', async ({ page }) => {
    await unlock(page);
    await page.evaluate(() => showPanel('driver'));
    await expect(page.locator('#drv-bubble-toggle')).toBeVisible();
  });

  test('populates the venue list and driver form fields', async ({ page }) => {
    await unlock(page);

    await page.evaluate(() => showPanel('venues'));
    const venueNodes = await page.locator('#panel-venues *').count();
    expect(venueNodes, 'venue panel should render the venue list').toBeGreaterThan(20);

    await page.evaluate(() => showPanel('driver'));
    const fields = await page.locator('#panel-driver input, #panel-driver textarea').count();
    expect(fields, 'driver panel should render editable fields').toBeGreaterThan(0);
  });
});
