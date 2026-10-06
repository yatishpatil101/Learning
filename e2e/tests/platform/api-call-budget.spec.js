import { test, expect } from '../../fixtures/live.js';

/** Request budget on load: public config is one `GET /bootstrap`, dashboard/owner hub use one `GET /me/dashboard` that primes per-section reads,
 * and similar listings (up to 200 rows) load only when scrolled near. */

const RETIRED = /^\/api\/(flags|geo|cities|plans|pricing|move-pack|listing-policy)$/;

function countGets(page) {
  const seen = new Map();
  page.on('request', (r) => {
    if (r.method() !== 'GET' || !r.url().includes('/api/')) return;
    const url = new URL(r.url());
    const key = url.pathname + url.search;
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  return {
    paths: () => [...seen.keys()].map((k) => k.split('?')[0]),
    timesPath: (path) => [...seen].filter(([k]) => k.split('?')[0] === path).reduce((n, [, c]) => n + c, 0),
    keys: () => [...seen.keys()],
  };
}

test('a guest home page reads public config once, from /bootstrap', async ({ page, consoleErrors }) => {
  const gets = countGets(page);
  await page.goto('/');
  await expect(page.locator('h1').first()).toBeVisible();
  await expect.poll(() => gets.timesPath('/api/bootstrap')).toBe(1);

  expect(gets.paths().filter((p) => RETIRED.test(p))).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

const DASHBOARD_SECTIONS = [
  '/api/me/listings', '/api/me/flatmate-posts', '/api/me/flatmate-rooms', '/api/me/flatmate-groups',
  '/api/me/contact-requests', '/api/me/photo-requests', '/api/me/documents/requests',
  '/api/me/flatmate-requests', '/api/me/group-applications', '/api/visits', '/api/me/visit-requests',
  '/api/me/tenancies', '/api/me/property-reviews', '/api/me/recent-searches',
  '/api/me/service-request-invites', '/api/me/managed-properties', '/api/me/entitlements', '/api/me/deals',
];

for (const [name, url] of [['dashboard', '/dashboard'], ['owner hub', '/owner-hub']]) {
  test(`the ${name} reads its inbox sections once, from /me/dashboard`, async ({ page, login, consoleErrors }) => {
    await login.asOwner();
    const gets = countGets(page);
    const dashboardRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/me/dashboard');
    await page.goto(url);
    await dashboardRead;
    // The panels' follow-up reads (quota, leads) re-run once the listings land.
    await page.waitForTimeout(1500);

    expect(gets.timesPath('/api/me/dashboard')).toBe(1);
    for (const path of DASHBOARD_SECTIONS) expect(gets.timesPath(path), path).toBe(0);
    expect(gets.timesPath('/api/me/bootstrap')).toBe(1);
    expect(gets.paths().filter((p) => RETIRED.test(p))).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
test.describe('similar listings', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('load only once the visitor scrolls near them', async ({ page, consoleErrors }) => {
    const gets = countGets(page);
    const isSimilarRead = (key) => key.startsWith('/api/properties?') && /[?&]size=100(&|$)/.test(key);

    await page.goto('/property/p5000');
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);
    expect(gets.keys().filter(isSimilarRead)).toEqual([]);

    const similarRead = page.waitForRequest((r) => isSimilarRead(new URL(r.url()).pathname + new URL(r.url()).search));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await similarRead;
    expect(consoleErrors).toEqual([]);
  });
});

test('the societies directory reads one filtered page, then the next on Show more', async ({ page, consoleErrors }) => {
  const gets = countGets(page);
  const firstPage = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/societies');
  await page.goto('/societies');
  const body = await (await firstPage).body();
  await expect(page.locator('a[href^="/society/"]').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);

  expect(gets.timesPath('/api/societies')).toBe(1);
  expect(gets.keys().filter((k) => k.startsWith('/api/societies?'))).toEqual(['/api/societies?sort=relevance&page=0&size=24']);
  expect(body.length, 'the first paint is one small page, not the 271 KB catalogue').toBeLessThan(30_000);

  await page.getByRole('button', { name: /show more/i }).click();
  await expect.poll(() => gets.timesPath('/api/societies')).toBe(2);
  expect(gets.keys()).toContain('/api/societies?sort=relevance&page=1&size=24');
  expect(consoleErrors).toEqual([]);
});
