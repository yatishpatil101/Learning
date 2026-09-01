import { test, expect } from '../../fixtures/live.js';

const PAGES = [
  ['/privacy', 'Privacy Policy'],
  ['/terms', 'Terms of Service'],
  ['/refund-policy', 'Refund Policy'],
  ['/disclaimer', 'Disclaimer'],
];

// Seed cookie consent so the banner doesn't overlap bottom-of-page clicks
// in tests that aren't specifically about the banner.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('Legal pages', () => {
  for (const [path, title] of PAGES) {
    test(`${path} renders title + table of contents`, async ({ page }) => {
      await seedConsent(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      const toc = page.locator('.legal-toc');
      await expect(toc).toBeVisible();
      expect(await toc.getByRole('button').count()).toBeGreaterThan(1);
    });
  }

  test('TOC jump scrolls the matching section into view', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/privacy');
    const firstItem = page.locator('.legal-toc button').first();
    const label = (await firstItem.textContent()).trim();
    await firstItem.click();
    await expect(page.locator('.legal-prose h2', { hasText: label }).first()).toBeInViewport();
  });

  test('Terms → Refund Policy uses SPA navigation (no full reload)', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/terms');
    await page.evaluate(() => { window.__noReload = true; });
    await page.locator('.legal-prose').getByRole('link', { name: 'Refund Policy' }).click();
    await page.waitForURL('**/refund-policy');
    await expect(page.getByRole('heading', { level: 1, name: 'Refund Policy' })).toBeVisible();
    expect(await page.evaluate(() => window.__noReload)).toBe(true);
  });

  test('Related-policies nav excludes the current page and links out', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/privacy');
    const nav = page.getByRole('navigation', { name: 'Related policies' });
    await expect(nav.getByRole('link', { name: 'Privacy Policy' })).toHaveCount(0);
    await nav.getByRole('link', { name: 'Terms of Service' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
  });
});

test.describe('Cookie consent (DPDPA)', () => {
  test('shows on first visit; Accept all persists and hides', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Cookie preferences' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Accept all' }).click();
    await expect(dialog).toBeHidden();
    const consent = await page.evaluate(() => JSON.parse(localStorage.getItem('dz_cookie_consent_v1')));
    expect(consent.marketing).toBe(true);
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Cookie preferences' })).toHaveCount(0);
  });

  test('Reject non-essential stores false; footer link reopens preferences', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Cookie preferences' });
    await dialog.getByRole('button', { name: 'Reject non-essential' }).click();
    const consent = await page.evaluate(() => JSON.parse(localStorage.getItem('dz_cookie_consent_v1')));
    expect(consent.marketing).toBe(false);
    expect(consent.analytics).toBe(false);
    await page.getByRole('button', { name: 'Cookie preferences' }).click();
    await expect(page.getByRole('dialog', { name: 'Cookie preferences' })).toBeVisible();
    await expect(page.getByRole('switch', { name: /Analytics cookies/i })).toBeVisible();
  });
});
