import { test, expect } from '../../../fixtures/base.js';

// Interior & Renovation service landing (/services/interior-renovation) — a PUBLIC,
// bespoke page (not ServiceLanding). It has no calculator; its interactive touches are
// the FAQ accordion, the before/after comparison slider, and the "Book a Free Design
// Consultation" lead form (in-handler sign-in gate). Behaviour verified from
// pages/consumer/services/InteriorRenovation.jsx and i18n/locales/en/services.json.

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('Interior & Renovation landing', () => {
  test('renders the hero and the consultation form', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/interior-renovation');

    await expect(page.locator('h1')).toContainText('Interiors that');
    await expect(page.locator('h1')).toContainText('feel like home');
    await expect(page.getByRole('heading', { name: 'See the Transformation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Book a Free Design Consultation' })).toBeVisible();
  });

  test('the FAQ accordion expands on click', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/interior-renovation');

    const firstFaq = page.locator('.faq-q').first();
    await expect(firstFaq).toHaveAttribute('aria-expanded', 'false');
    await firstFaq.click();
    await expect(firstFaq).toHaveAttribute('aria-expanded', 'true');
  });

  test('the before/after slider moves the reveal divider', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/interior-renovation');

    const range = page.locator('.ba-range');
    const after = page.locator('.ba-after');
    const before = await after.getAttribute('style');
    await range.focus();
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    expect(await after.getAttribute('style')).not.toBe(before);
  });

  test('booking the consultation while signed out routes to sign-in (service gate)', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/services/interior-renovation');

    await page.getByRole('button', { name: 'Book My Consultation' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
  });

  test('loads with no real console errors', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await page.goto('/services/interior-renovation');
    await expect(page.locator('h1')).toContainText('Interiors that');
    expect(consoleErrors).toEqual([]);
  });
});
