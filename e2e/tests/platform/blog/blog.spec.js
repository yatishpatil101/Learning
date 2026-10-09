import { test, expect } from '../../../fixtures/live.js';
import { trackErrors } from '../../../helpers/console.js';

const SLUG = 'rent-agreement-pune';

test('the blog index links to posts, and a post carries its own SEO head', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/blog', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1', { hasText: 'Pune property, explained' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://draazy.com/blog');

  await page.locator(`a[href="/blog/${SLUG}"]`).first().click();
  await page.waitForURL(new RegExp(`/blog/${SLUG}$`));

  await expect(page.locator('h1', { hasText: 'Rent agreement in Pune' })).toBeVisible();
  await expect(page.locator('.doc-prose h2').first()).toBeVisible();
  await expect(page).toHaveTitle(/^Rent agreement in Pune/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://draazy.com/blog/${SLUG}`);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /registered/);
  await expect(page.locator('a[href="/listings?deal=rent"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('an unknown post is noindex and offers a way back', async ({ page }) => {
  await page.goto('/blog/no-such-post', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1', { hasText: 'Post not found' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.locator('a[href="/blog"]', { hasText: 'Back to the blog' }).click();
  await expect(page.locator('h1', { hasText: 'Pune property, explained' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test('topic chips filter the guides and survive a reload', async ({ page }) => {
  await page.goto('/blog', { waitUntil: 'domcontentloaded' });
  const topics = page.getByRole('navigation', { name: 'Topics' });
  await expect(topics).toBeVisible({ timeout: 30_000 });
  const cards = page.locator('a[href^="/blog/"]');
  const all = await cards.count();

  await topics.getByRole('button', { name: /^Buying/ }).click();
  await expect(page).toHaveURL(/\/blog\?topic=buying$/);
  await expect(topics.getByRole('button', { name: /^Buying/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('a[href="/blog/check-maharera-registration"]')).toBeVisible();
  await expect(page.locator('a[href="/blog/rent-agreement-pune"]')).toHaveCount(0);
  expect(await cards.count()).toBeLessThan(all);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(topics.getByRole('button', { name: /^Buying/ })).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await topics.getByRole('button', { name: /^All guides/ }).click();
  await expect(page).toHaveURL(/\/blog$/);
  await expect(cards).toHaveCount(all);
});

test('the footer links to the blog', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const link = page.locator('footer a[href="/blog"]').first();
  if (!(await link.isVisible())) await page.locator('footer button', { hasText: /^Company$/ }).first().click();
  await link.click();
  await expect(page).toHaveURL(/\/blog$/);
});
