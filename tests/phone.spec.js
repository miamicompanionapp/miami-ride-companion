// E2E: phone support for the "Open on your phone" QR link.
// The app is a landscape tablet kiosk; these verify the phone-only behavior
// AND that the kiosk viewport is left untouched.
const { test, expect } = require('./fixtures');

test.describe('Phone — portrait', { tag: ['@index', '@phone'] }, () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows the rotate-to-landscape prompt', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#rotate-overlay')).toBeVisible();
    await expect(page.locator('.rotate-title')).toContainText(/rotate/i);
  });
});

test.describe('Phone — landscape', { tag: ['@index', '@phone'] }, () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('hides the prompt, shrinks the sidebar, renders the guide', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('#gp-minis .gp-mini', { timeout: 10_000 });
    await expect(page.locator('#rotate-overlay')).toBeHidden();
    const sidebarW = await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width);
    expect(sidebarW, 'sidebar should shrink below the 220px kiosk width').toBeLessThan(200);
    await expect(page.locator('#gp-hero-slot')).not.toBeEmpty();
  });
});

test.describe('Tablet kiosk — unaffected by phone rules', { tag: ['@index', '@phone'] }, () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('no rotate prompt and full 220px sidebar', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('#gp-minis .gp-mini', { timeout: 10_000 });
    await expect(page.locator('#rotate-overlay')).toBeHidden();
    const sidebarW = await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width);
    expect(sidebarW).toBe(220);
  });
});
