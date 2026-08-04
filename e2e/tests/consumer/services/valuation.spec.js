import { test, expect } from '../../../fixtures/base.js';

// Property Valuation service landing (/services/property-valuation) — a PUBLIC, bespoke
// page (not ServiceLanding). Behaviour verified from
// pages/consumer/services/PropertyValuation.jsx (the `est` useMemo instant-estimate math
// and the in-handler sign-in gate on the certified-report form) and
// i18n/locales/en/services.json (valuation.* copy).

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('Property Valuation landing', () => {
  test('renders the hero and the instant valuation estimate widget', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/property-valuation');

    await expect(page.locator('h1')).toContainText('Know what your');
    await expect(page.locator('h1')).toContainText('property is really worth');
    await expect(page.getByRole('heading', { name: 'Instant Valuation Estimate' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Request a Certified Valuation Report' })).toBeVisible();
  });

  test('instant estimate recomputes when the carpet area changes', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/property-valuation');

    const widget = page.locator('.svc-quote');
    const out = widget.locator('.gradient-text');
    // Default 850 sq.ft in Baner yields a non-empty range (not the "—" placeholder).
    await expect(out).toContainText('₹');
    const before = await out.innerText();

    await widget.locator('input[type=number]').fill('2500');
    await page.waitForTimeout(150);
    expect(await out.innerText()).not.toBe(before);
  });

  test('requesting the certified report while signed out routes to sign-in (service gate)', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/property-valuation');

    await page.locator('form').getByRole('button', { name: 'Request Valuation' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
  });

  test('loads with no real console errors', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await page.goto('/services/property-valuation');
    await expect(page.locator('h1')).toContainText('Know what your');
    expect(consoleErrors).toEqual([]);
  });
});
