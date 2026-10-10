import { test, expect } from '../../../fixtures/live.js';

test('the shell names Draazy as one organisation and website for search and AI answers', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const nodes = blocks.map((b) => JSON.parse(b)).flatMap((j) => j['@graph'] || [j]);
  const org = nodes.find((n) => n['@type'] === 'Organization');
  expect(org).toMatchObject({ name: 'Draazy', url: 'https://draazy.com/', areaServed: { name: 'Pune' } });
  expect(nodes.find((n) => n['@type'] === 'WebSite')).toMatchObject({ publisher: { '@id': org['@id'] } });
});

test('robots keeps private routes out and owner listing in; llms.txt points at the guides', async ({ page }) => {
  const robots = await (await page.request.get('/robots.txt')).text();
  for (const path of ['/admin', '/staff', '/dashboard', '/messages', '/signin', '/checkout']) {
    expect(robots).toMatch(new RegExp(`^Disallow: ${path}\\r?$`, 'm'));
  }
  expect(robots).not.toMatch(/list-property|documents/);
  expect(robots).toMatch(/^Sitemap: https:\/\/draazy\.com\/sitemap\.xml\r?$/m);

  const llms = await page.request.get('/llms.txt');
  expect(llms.ok()).toBe(true);
  expect(await llms.text()).toMatch(/^# Draazy\r?\n\r?\n> .*broker-free/);
});

test('static routes and home carry their own title and canonical, and Back restores them', async ({ page }) => {
  const canonical = page.locator('link[rel="canonical"]');
  await page.goto('/services/rent-agreement', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('Online Rent Agreement in Pune with e-Registration | Draazy');
  await expect(canonical).toHaveAttribute('href', 'https://draazy.com/services/rent-agreement');

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(canonical).toHaveAttribute('href', 'https://draazy.com/');
  const homeTitle = await page.title();
  await page.getByRole('contentinfo').getByRole('link', { name: 'Terms of service', exact: true }).click();
  await expect(page).toHaveTitle('Terms of Service | Draazy');
  await expect(canonical).toHaveAttribute('href', 'https://draazy.com/terms');

  await page.goBack();
  await expect(page).toHaveTitle(homeTitle);
  await expect(canonical).toHaveCount(1);
  await expect(canonical).toHaveAttribute('href', 'https://draazy.com/');
});

test('the share image every page advertises is a real image', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const url = await page.locator('meta[property="og:image"]').getAttribute('content');
  const res = await page.request.get(new URL(url).pathname);
  expect(res.headers()['content-type']).toBe('image/jpeg');
});
