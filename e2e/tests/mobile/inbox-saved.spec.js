import { test, expect } from '../../fixtures/live.js';
import { trackErrors } from '../../helpers/console.js';

// Only consent is seeded because its overlay covers the viewport edges under test.
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

// The seeded Rahul-to-Meera thread.
const THREAD = 'f1c70006-0000-4000-8000-000000000001';

async function seed(page) {
  await page.addInitScript(() => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
  });
}

test.describe('Mobile inbox + saved', () => {
  test('Messages is full-screen and Saved tabs fit one row on mobile, with no console errors, while desktop keeps its footer', async ({ page, login }) => {
    test.slow();
    const errors = trackErrors(page);
    await seed(page);
    await login.asBuyer();
    await page.setViewportSize(MOBILE);

    await test.step('Messages is full-screen on mobile: footer hidden, edge-to-edge, composer visible', async () => {
      await page.goto(`/messages?c=${THREAD}`);
      await expect(page.locator('.pc-input')).toBeVisible();
      // Marketing footer is hidden on the messages route (mobile only).
      await expect(page.locator('footer')).toBeHidden();
      // Edge-to-edge: the chat wrap spans the full viewport width (no side gutter).
      const box = await page.locator('.pc-wrap').boundingBox();
      expect(box.width).toBeCloseTo(390, 0);
      const radius = await page.locator('.pc-wrap').evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
      expect(parseFloat(radius)).toBe(0);
    });

    await test.step('Saved category tabs are on a single row on mobile with the short room label', async () => {
      await page.goto('/saved');
      const tabs = page.locator('.saved-tabs .saved-tab');
      await expect(tabs).toHaveCount(4);
      await expect(page.locator('.saved-tabs')).toContainText('Rooms');
      const tops = await tabs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
    });

    await test.step('No console errors on Saved + Messages at 390px', async () => {
      for (const p of ['/saved', '/notifications', '/messages']) {
        await page.goto(p);
        await page.waitForTimeout(400);
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });

    await test.step('Desktop keeps the footer on /messages (mobile-only rule)', async () => {
      await page.setViewportSize(DESKTOP);
      await page.goto(`/messages?c=${THREAD}`);
      await expect(page.locator('footer')).toBeVisible();
      const box = await page.locator('.pc-wrap').boundingBox();
      // Boxed chat on desktop is narrower than the full viewport.
      expect(box.width).toBeLessThan(1280);
    });
  });
});
