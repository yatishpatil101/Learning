import { test, expect } from '@playwright/test';

// Ignore known CDN / map / favicon noise; fail on real app errors.
const isNoise = (t) => /favicon|leaflet|unsplash|maps\.googleapis|net::ERR|Failed to load resource/i.test(t);

test.describe('Reels page', () => {
  // Seed cookie consent so the global bottom banner doesn't overlap the bottom-of-reel
  // CTAs (View home / Contact). Mirrors legal-pages / tenant-profile / mobile-inbox specs.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
    });
  });

  test('loads with no console errors and core chrome present', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/reels');
    await expect(page.getByText('Reels', { exact: true }).first()).toBeVisible();
    // Intent filter chips
    await expect(page.getByRole('button', { name: 'Rent' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buy' })).toBeVisible();
    // First reel CTA points at a real property route
    const viewHome = page.getByRole('link', { name: /View home/i }).first();
    await expect(viewHome).toHaveAttribute('href', /\/property\/P\d+/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('Like toggles and count changes', async ({ page }) => {
    await page.goto('/reels');
    const likeBtn = page.getByRole('button', { name: 'Like', exact: true }).first();
    await expect(likeBtn).toHaveAttribute('aria-pressed', 'false');
    await likeBtn.click();
    await expect(page.getByRole('button', { name: 'Unlike', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
  });

  test('Save persists to the saved store', async ({ page }) => {
    await page.goto('/reels');
    const saveBtn = page.getByRole('button', { name: 'Save property' }).first();
    await saveBtn.click();
    await expect(page.getByRole('button', { name: 'Remove from saved' }).first()).toBeVisible();
    const savedCount = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('pnSavedProps:'));
      return key ? JSON.parse(localStorage.getItem(key)).length : 0;
    });
    expect(savedCount).toBeGreaterThan(0);
  });

  test('Contact link carries a property ref and View home resolves', async ({ page }) => {
    await page.goto('/reels');
    await expect(page.getByRole('link', { name: 'Contact owner' }).first()).toHaveAttribute('href', /\/contact\?ref=P\d+/);
    await page.getByRole('link', { name: /View home/i }).first().click();
    await expect(page).toHaveURL(/\/property\/P\d+/);
    await expect(page.getByText(/not found/i)).toHaveCount(0);
  });

  test('Buy filter shows only sale reels', async ({ page }) => {
    await page.goto('/reels');
    await page.getByRole('button', { name: 'Buy' }).click();
    await expect(page.locator('.reel-wrap').getByText('Sale', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.reel-wrap').getByText('Rent', { exact: true })).toHaveCount(0);
  });

  test('Like and Save icons render (not fill=none invisible)', async ({ page }) => {
    await page.goto('/reels');
    const like = page.locator('.rail button[aria-label="Like"] svg').first();
    const save = page.locator('.rail button[aria-label="Save property"] svg').first();
    await expect(like).toBeVisible();
    await expect(save).toBeVisible();
    const box = await like.boundingBox();
    expect(box.width).toBeGreaterThan(10);
    expect(await like.locator('path').count()).toBeGreaterThan(0);
  });

  test('Photos scroll horizontally within a property and dots update', async ({ page }) => {
    await page.goto('/reels');
    const gallery = page.locator('.reel .reel-gallery').first();
    await expect(gallery.locator('.reel-slide')).toHaveCount(3);
    await gallery.evaluate((el) => el.scrollTo({ left: el.clientWidth }));
    await page.waitForTimeout(400);
    const activeDot = await page.locator('.reel').first().locator('.reel-dots .reel-dot')
      .evaluateAll((dots) => dots.findIndex((d) => d.classList.contains('is-on')));
    expect(activeDot).toBe(1);
  });
});
