import { test, expect } from '../../../fixtures/base.js';

// Property Legal service landing (/services/property-legal) — a PUBLIC page built on
// ServiceLanding. Behaviour verified from pages/consumer/services/PropertyLegal.jsx,
// LegalCostCalc.jsx (computeStampDuty math), the shared ServiceLanding.jsx (sign-in gate
// on quote submit) and i18n/locales/en/services.json (legal.* copy).

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('Property Legal landing', () => {
  test('renders the hero and the stamp-duty calculator', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/property-legal');

    await expect(page.locator('h1')).toContainText('Property registration,');
    await expect(page.locator('h1')).toContainText('made effortless');
    await expect(page.getByRole('heading', { name: 'Talk to a Legal Expert' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Estimate your stamp duty & registration' })).toBeVisible();
  });

  test('stamp-duty total updates when the property value slider moves', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/property-legal');

    const calc = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Estimate your stamp duty & registration' }) });
    const total = calc.locator('.gradient-text');
    // Default ₹75L value, Pune municipal 6% → ₹4,80,000 total.
    await expect(total).toContainText('₹4,80,000');

    const slider = calc.locator('input[type=range]');
    await slider.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
    // A higher property value must yield a higher (different) government-charges figure.
    // The assertion below already retries, so the sleep that used to sit here bought nothing.
    await expect(total).not.toContainText('₹4,80,000');
  });

  test('requesting assistance while signed out routes to sign-in (service gate)', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/property-legal');

    await page.locator('#quote').getByRole('button', { name: 'Request Assistance' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
  });

  test('loads with no real console errors', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await page.goto('/services/property-legal');
    await expect(page.locator('h1')).toContainText('Property registration,');
    expect(consoleErrors).toEqual([]);
  });
});
