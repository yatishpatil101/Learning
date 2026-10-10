import { test, expect } from '../../../fixtures/live.js';

const BYLINE = /By Draazy Editorial Team · Updated \d{1,2} [A-Z][a-z]+ 20\d\d/;

test('a blog post and a locality guide carry the editorial byline', async ({ page }) => {
  await page.goto('/blog/rent-agreement-pune', { waitUntil: 'domcontentloaded' });
  const post = page.locator('article header p', { hasText: 'Draazy Editorial Team' });
  await expect(post).toHaveText(BYLINE, { timeout: 30_000 });
  await expect(post.getByRole('link', { name: 'Draazy Editorial Team' })).toHaveAttribute('href', '/about');

  await page.goto('/locality/baner', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('p', { hasText: 'Draazy Editorial Team' }).first()).toHaveText(BYLINE, { timeout: 30_000 });
});

test('a locality guide links to the rent and buy pages for the area', async ({ page }) => {
  await page.goto('/locality/baner', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Flats for rent in Baner' })).toHaveAttribute('href', '/rent/baner', { timeout: 30_000 });
  await expect(page.getByRole('link', { name: 'Property for sale in Baner' })).toHaveAttribute('href', '/buy/baner');
});

test('a post table scrolls inside the article instead of widening the phone page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/blog/rent-agreement-pune', { waitUntil: 'domcontentloaded' });
  const table = page.locator('.doc-prose table').first();
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table).toHaveCSS('overflow-x', 'auto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('blog and locality share cards are real, light JPEGs', async ({ page }) => {
  for (const path of ['/og/blog/rent-agreement-pune.jpg', '/og/locality/baner.jpg']) {
    const res = await page.request.get(path);
    expect(res.headers()['content-type']).toBe('image/jpeg');
    expect((await res.body()).length).toBeLessThan(60 * 1024);
  }
});
