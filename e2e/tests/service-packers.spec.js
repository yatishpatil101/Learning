import { test, expect } from '../fixtures/base.js';

// Packers & Movers service landing (/services/packers-movers) — a PUBLIC page built on
// ServiceLanding. Behaviour verified from pages/consumer/services/PackersMovers.jsx,
// PackersEstimator.jsx (estimateMove math), the shared ServiceLanding.jsx (sign-in gate
// on quote submit) and i18n/locales/en/services.json (packers.* copy).

// The global cookie-consent banner is role="dialog"; seed consent so it never overlays
// the page or intercepts clicks on the estimator / quote form.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('Packers & Movers landing', () => {
  test('renders the hero and the moving-cost estimator', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/packers-movers');

    await expect(page.locator('h1')).toContainText('Stress-free home shifting');
    await expect(page.locator('h1')).toContainText('in & from Pune');
    await expect(page.getByRole('heading', { name: 'Get a Free Quote' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Instant moving-cost estimate' })).toBeVisible();
  });

  test('estimator recomputes the moving-cost range when the home size changes', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/packers-movers');

    const est = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Instant moving-cost estimate' }) });
    const out = est.locator('.gradient-text');
    // Defaults: 2 BHK, within Pune, standard packing, ground/lift → ₹9,000 – ₹18,000.
    await expect(out).toContainText('₹9,000');
    await expect(out).toContainText('₹18,000');

    await est.locator('.pn-dropdown__trigger').first().click();
    await page.getByRole('option', { name: '4 BHK / Villa' }).click();
    // 4 BHK/Villa base [22000, 40000] × factor 1 → ₹22,000 – ₹40,000.
    await expect(out).toContainText('₹22,000');
    await expect(out).toContainText('₹40,000');
  });

  test('submitting the quote while signed out routes to sign-in (service gate)', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/packers-movers');

    await page.getByRole('button', { name: 'Request Free Quote' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
  });

  test('loads with no real console errors', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await page.goto('/services/packers-movers');
    await expect(page.locator('h1')).toContainText('Stress-free home shifting');
    expect(consoleErrors).toEqual([]);
  });
});
