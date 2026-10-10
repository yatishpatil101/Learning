import { test, expect } from '../../../fixtures/live.js';
import { trackErrors } from '../../../helpers/console.js';

async function openHelp(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
}

async function revealFooterLink(page, selector) {
  const link = page.locator(`footer ${selector}`).first();
  if (await link.isVisible()) return link;
  await page.locator('footer button', { hasText: /^Company$/ }).first().click();
  await expect(link).toBeVisible();
  return link;
}

const SLUG = 'what-is-draazy';

test('a footer help link stays tappable with the cookie banner showing', async ({ page }) => {
  await openHelp(page, '/help');
  const faq = await revealFooterLink(page, 'a[href="/help/faq"]');
  await faq.click();
  await page.waitForURL(/\/help\/faq$/, { timeout: 15_000 });
  await expect(page.locator('h1').first()).toBeVisible();
});

test('legacy language-prefixed help URLs redirect to the English help', async ({ page }) => {
  await test.step('/hi/help/a/<slug> redirects to the English article', async () => {
    const errors = trackErrors(page);
    await openHelp(page, `/hi/help/a/${SLUG}`);

    await expect(page).toHaveURL(new RegExp(`/help/a/${SLUG}$`));
    expect(new URL(page.url()).pathname).toBe(`/help/a/${SLUG}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.doc-prose').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  await test.step('the redirect keeps the query string and hash', async () => {
    await page.goto('/mr/help/search?q=rent#results', { waitUntil: 'domcontentloaded' });

    await expect.poll(() => {
      const u = new URL(page.url());
      return `${u.pathname}${u.search}${u.hash}`;
    }).toBe('/help/search?q=rent#results');
  });

  await test.step('the bare /hi/help root lands on /help', async () => {
    await openHelp(page, '/hi/help');
    expect(new URL(page.url()).pathname).toBe('/help');
  });
});
test.describe('Help SEO tags', () => {
  test('in-app navigation swaps the title, description and canonical between help pages', async ({ page }) => {
    const canonical = page.locator('link[rel="canonical"]');
    const description = page.locator('meta[name="description"]');
    await openHelp(page, '/help');
    await expect(page).toHaveTitle('Draazy Help centre');
    await expect(canonical).toHaveAttribute('href', 'https://draazy.com/help');
    const helpDescription = await description.getAttribute('content');

    await page.getByRole('link', { name: /^Getting started / }).click();
    await expect(page).toHaveTitle('Getting started · Draazy Help centre');
    await expect(canonical).toHaveAttribute('href', 'https://draazy.com/help/c/getting-started');
    await expect(description).toHaveAttribute('content', /^What Draazy is, how zero brokerage works/);

    await page.goBack();
    await expect(page).toHaveTitle('Draazy Help centre');
    await expect(canonical).toHaveCount(1);
    await expect(description).toHaveAttribute('content', helpDescription);
  });
  test('an article self-canonicalises and declares no language alternates', async ({ page }) => {
    await openHelp(page, `/help/a/${SLUG}`);

    await expect
      .poll(async () => {
        const href = await page.locator('link[rel="canonical"]').getAttribute('href');
        return href && new URL(href, 'http://localhost').pathname;
      })
      .toBe(`/help/a/${SLUG}`);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
  });

  test('staff runbooks are marked noindex', async ({ page, login }) => {
    await login.asAdmin();
    await openHelp(page, '/help/a/verification-sla');

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots || '').toMatch(/noindex/);
  });
});