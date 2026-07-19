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

  test('shows desktop panel by default (non-iOS, non-Android UA in Chromium)', async ({ page }) => {
    await expect(page.locator('#ig-tab-desktop')).toHaveClass(/active/);
    await expect(page.locator('#ig-tab-ios')).not.toHaveClass(/active/);
    await expect(page.locator('#ig-tab-android')).not.toHaveClass(/active/);
    const steps = await page.locator('#ig-steps-list .ig-step').count();
    expect(steps).toBeGreaterThan(0);
    // Browser picker should be visible on desktop, with Chrome preselected
    await expect(page.locator('#ig-browser-pick')).toBeVisible();
    await expect(page.locator('#ig-browser-select')).toHaveValue('chrome');
  });

  test('switching platform tabs updates steps and browser picker', async ({ page }) => {
    await page.locator('#ig-tab-ios').click();
    await expect(page.locator('#ig-tab-ios')).toHaveClass(/active/);
    await expect(page.locator('#ig-browser-pick')).toBeHidden();

    await page.locator('#ig-tab-android').click();
    await expect(page.locator('#ig-tab-android')).toHaveClass(/active/);
    await expect(page.locator('#ig-browser-pick')).toBeVisible();
    await expect(page.locator('#ig-browser-select')).toHaveValue('chrome');

    await page.locator('#ig-browser-select').selectOption('samsung');
    const firstStep = await page.locator('#ig-steps-list .ig-step').first().innerText();
    expect(firstStep).toMatch(/Samsung Internet/);
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
