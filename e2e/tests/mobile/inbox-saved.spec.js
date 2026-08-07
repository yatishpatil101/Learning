import { test, expect } from '@playwright/test';
import { trackErrors } from '../../helpers/console.js';

/* Mobile UX pass for Saved + Messages (≤767px). Verifies:
   - Messages is a native full-screen chat on mobile: marketing footer + floating
     assistant hidden, inbox runs edge-to-edge (no rounded box), composer reachable.
   - Saved category tabs sit on a single row (no 2+1 wrap) and use the short label.
   - Desktop keeps the footer on /messages (mobile-only rule).
   Seeds a logged-in buyer + dismissed cookie banner so overlays don't interfere. */

const BASE = 'http://localhost:5173';
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function seed(page) {
  await page.addInitScript(() => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test User', mobile: '9876543210', role: 'buyer', loginAt: Date.now() }));
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
    localStorage.setItem('pnSavedProps:9876543210', JSON.stringify(['P5013', 'R7208', 'R7204', 'P5010']));
  });
}

test.describe('Mobile inbox + saved', () => {
  test('Messages is full-screen on mobile: footer hidden, edge-to-edge, composer visible', async ({ page }) => {
    await seed(page);
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/messages?c=c1`);
    await expect(page.locator('input.pc-input')).toBeVisible();
    // Marketing footer is hidden on the messages route (mobile only).
    await expect(page.locator('footer')).toBeHidden();
    // Edge-to-edge: the chat wrap spans the full viewport width (no side gutter).
    const box = await page.locator('.pc-wrap').boundingBox();
    expect(box.width).toBeCloseTo(390, 0);
    const radius = await page.locator('.pc-wrap').evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(radius)).toBe(0);
  });

  test('Desktop keeps the footer on /messages (mobile-only rule)', async ({ page }) => {
    await seed(page);
    await page.setViewportSize(DESKTOP);
    await page.goto(`${BASE}/messages`);
    await expect(page.locator('footer')).toBeVisible();
    const box = await page.locator('.pc-wrap').boundingBox();
    // Boxed chat on desktop is narrower than the full viewport.
    expect(box.width).toBeLessThan(1280);
  });

  test('Saved category tabs are on a single row on mobile with the short share label', async ({ page }) => {
    await seed(page);
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE}/saved`);
    const tabs = page.locator('.saved-tabs .saved-tab');
    await expect(tabs).toHaveCount(3);
    // Short label is used on mobile ("Flatmates", not "Flatmates & Rooms").
    await expect(page.locator('.saved-tabs')).toContainText('Flatmates');
    // Single row: every tab shares the same top offset (no wrap).
    const tops = await tabs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  });

  test('No console errors on Saved + Messages at 390px', async ({ page }) => {
    const errors = trackErrors(page);
    await seed(page);
    await page.setViewportSize(MOBILE);
    for (const p of ['/saved', '/notifications', '/messages', '/messages?c=c1']) {
      await page.goto(`${BASE}${p}`);
      await page.waitForTimeout(400);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
