// Tests for the PWA install gate — shown to passengers who open the app in a
// regular browser instead of launching the installed PWA.
// These tests deliberately do NOT set the pwa-bypass flag so the gate behaviour
// is exercised in a real non-standalone context.
const { test, expect } = require('@playwright/test');

test.describe('PWA install gate', { tag: ['@index', '@smoke'] }, () => {
  test.beforeEach(async ({ page }) => {
    // No pwa-bypass — gate should be active
    await page.goto('/index.html');
  });

  test('gate is visible and app shell is hidden in browser context', async ({ page }) => {
    const gateVisible = await page.locator('#install-gate').isVisible();
    const appHidden   = await page.evaluate(() => document.getElementById('app').style.display === 'none');
    expect(gateVisible).toBe(true);
    expect(appHidden).toBe(true);
  });

  test('shows other-platform panel by default (non-iOS, non-Android UA in Chromium)', async ({ page }) => {
    const otherVisible   = await page.locator('#ig-steps-other').isVisible();
    const iosHidden      = await page.evaluate(() => document.getElementById('ig-steps-ios').style.display === 'none');
    const androidHidden  = await page.evaluate(() => document.getElementById('ig-steps-android').style.display === 'none');
    expect(otherVisible).toBe(true);
    expect(iosHidden).toBe(true);
    expect(androidHidden).toBe(true);
  });

  test('5 taps on the icon bypass the gate and boot the app', async ({ page }) => {
    const icon = page.locator('#ig-icon-tap');
    for (let i = 0; i < 5; i++) await icon.click();
    // Gate should hide, app should appear, and content should load
    await expect(page.locator('#install-gate')).toBeHidden();
    await expect(page.locator('#app')).toBeVisible();
    // App has booted: nav exists and is interactable
    await expect(page.locator('#nav-guide')).toBeVisible();
  });

  test('@negative fewer than 5 taps does not bypass the gate', async ({ page }) => {
    const icon = page.locator('#ig-icon-tap');
    for (let i = 0; i < 4; i++) await icon.click();
    const gateStillVisible = await page.locator('#install-gate').isVisible();
    expect(gateStillVisible).toBe(true);
  });
});
