import { test, expect } from '../../fixtures/live.js';

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
  test('/privacy renders title + table of contents, jumps to a section and links to related policies', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
    const toc = page.locator('.legal-toc');
    await expect(toc).toBeVisible();
    expect(await toc.getByRole('button').count()).toBeGreaterThan(1);

    await test.step('TOC jump scrolls the matching section into view', async () => {
      const firstItem = page.locator('.legal-toc button').first();
      const label = (await firstItem.textContent()).trim();
      await firstItem.click();
      await expect(page.locator('.legal-prose h2', { hasText: label }).first()).toBeInViewport();
    });

    await test.step('Related-policies nav excludes the current page and links out', async () => {
      const nav = page.getByRole('navigation', { name: 'Related policies' });
      await expect(nav.getByRole('link', { name: 'Privacy Policy' })).toHaveCount(0);
      await nav.getByRole('link', { name: 'Terms of Service' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
    });
  });

  test('/disclaimer renders title + table of contents', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/disclaimer');
    await expect(page.getByRole('heading', { level: 1, name: 'Disclaimer' })).toBeVisible();
    const toc = page.locator('.legal-toc');
    await expect(toc).toBeVisible();
    expect(await toc.getByRole('button').count()).toBeGreaterThan(1);
  });

  test('Terms → Refund Policy uses SPA navigation (no full reload) and both render title + table of contents', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
    const toc = page.locator('.legal-toc');
    await expect(toc).toBeVisible();
    expect(await toc.getByRole('button').count()).toBeGreaterThan(1);

    await page.evaluate(() => { window.__noReload = true; });
    await page.locator('.legal-prose').getByRole('link', { name: 'Refund Policy' }).click();
    await page.waitForURL('**/refund-policy');
    await expect(page.getByRole('heading', { level: 1, name: 'Refund Policy' })).toBeVisible();
    expect(await page.evaluate(() => window.__noReload)).toBe(true);
    await expect(toc).toBeVisible();
    expect(await toc.getByRole('button').count()).toBeGreaterThan(1);
  });
});

test.describe('Cookie consent (DPDPA)', () => {
  test('shows on first visit; Accept all persists and hides; Reject non-essential stores false and the footer link reopens preferences', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Cookie preferences' });
    const consentRecord = () => page.evaluate(() => JSON.parse(localStorage.getItem('dz_cookie_consent_v1')));

    await test.step('Accept all persists and hides', async () => {
      await page.goto('/');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Accept all' }).click();
      await expect(dialog).toBeHidden();
      expect((await consentRecord()).marketing).toBe(true);
      await page.reload();
      await expect(dialog).toHaveCount(0);
    });

    await test.step('Reject non-essential stores false; footer link reopens preferences', async () => {
      await page.evaluate(() => localStorage.removeItem('dz_cookie_consent_v1'));
      await page.reload();
      await dialog.getByRole('button', { name: 'Reject non-essential' }).click();
      const consent = await consentRecord();
      expect(consent.marketing).toBe(false);
      expect(consent.analytics).toBe(false);
      await page.getByRole('button', { name: 'Cookie preferences' }).click();
      await expect(dialog).toBeVisible();
      await expect(page.getByRole('switch', { name: /Analytics cookies/i })).toBeVisible();
    });
  });
});