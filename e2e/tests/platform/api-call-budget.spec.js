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

for (const [desk, team] of [['rent-agreement', 'rental'], ['legal', 'legal'], ['interior', 'interior'], ['packers', 'packers'], ['valuation', 'valuation']]) {
  test(`the ${desk} desk counts open tickets from the queue summary, not a size=1 tickets read`, async ({ page, login, consoleErrors }) => {
    await login.asAdmin();
    const gets = countGets(page);
    const summaryRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/service-requests/queue-summary');
    await page.goto(`/admin/${desk}`);
    const summary = await (await summaryRead).json();
    await page.waitForTimeout(1000);

    expect(typeof summary.openTickets).toBe('number');
    expect(gets.keys().filter((k) => k.startsWith('/api/service-requests/queue-summary'))).toEqual([`/api/service-requests/queue-summary?team=${team}`]);
    expect(gets.keys().filter((k) => k.startsWith('/api/tickets?') && /[?&]size=1(&|$)/.test(k))).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

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

for (const [name, url, readyText] of [['the team page', '/admin/team', /Team/], ['a service desk', '/admin/home-loans', /Home Loans/i]]) {
  test(`${name} reads the back-office roster once, from /admin/team`, async ({ page, login, consoleErrors }) => {
    await login.asAdmin();
    const gets = countGets(page);
    const rosterRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/team');
    await page.goto(url);
    await rosterRead;
    await expect(page.getByText(readyText).first()).toBeVisible();
    await page.waitForTimeout(1000);

    expect(gets.timesPath('/api/admin/team')).toBe(1);
    expect(gets.timesPath('/api/users')).toBe(0);
    expect(gets.paths().filter((p) => p.endsWith('/permissions'))).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test('an admin page makes one light bell request, not three list reads', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  const gets = countGets(page);
  const bellRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/bell');
  await page.goto('/admin/settings');
  const body = await (await bellRead).body();
  await page.waitForTimeout(1000);

  expect(gets.timesPath('/api/admin/bell')).toBe(1);
  expect(gets.timesPath('/api/admin/settings')).toBeLessThanOrEqual(1);
  for (const path of ['/api/admin/properties', '/api/tickets', '/api/admin/property-reviews']) {
    expect(gets.timesPath(path), path).toBe(0);
  }
  expect(body.length, 'five slim rows per section, not five full admin rows').toBeLessThan(3_000);

  await page.getByRole('button', { name: 'Notifications' }).click();
  await page.getByRole('button', { name: 'Notifications' }).click();
  await page.waitForTimeout(500);
  expect(gets.timesPath('/api/admin/bell'), 'opening and closing the bell does not refetch it').toBe(1);
  expect(consoleErrors).toEqual([]);
});

test('the platform dashboard is one aggregate read with no whole-list downloads', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  const gets = countGets(page);
  const dashboardRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/dashboard');
  await page.goto('/admin');
  const body = await (await dashboardRead).body();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.waitForTimeout(1000);

  expect(gets.timesPath('/api/admin/dashboard')).toBe(1);
  expect(gets.keys().filter((k) => /[?&]size=(100|200)(&|$)/.test(k))).toEqual([]);
  for (const path of [
    '/api/admin/properties', '/api/admin/properties/summary', '/api/admin/enquiries', '/api/admin/deals',
    '/api/admin/visits', '/api/tickets', '/api/users', '/api/admin/analytics/traffic', '/api/admin/analytics/sla',
  ]) {
    expect(gets.timesPath(path), path).toBe(0);
  }
  expect(body.length).toBeLessThan(6_000);
  expect(consoleErrors).toEqual([]);
});

const DESKS = [
  {
    name: 'users reads one paged list that carries the counts, and the pending badge grants once',
    url: '/admin/users',
    ready: /Users|Customers/,
    once: ['/api/users', '/api/admin/badge-grants'],
    never: [],
    check: (gets) => {
      const reads = gets.keys().filter((k) => k.startsWith('/api/users?'));
      expect(reads).toHaveLength(1);
      expect(reads[0]).toContain('counts=true');
      expect(reads[0]).not.toMatch(/[?&]size=(1|100)(&|$)/);
    },
  },
  {
    name: 'support reads the queue once, with the tab counts on it',
    url: '/admin/support',
    ready: /Support/,
    once: ['/api/admin/support-tickets'],
    never: [],
    check: (gets) => expect(gets.keys().filter((k) => /[?&]size=1(&|$)/.test(k))).toEqual([]),
  },
  {
    name: 'flatmates reads one moderation queue for every kind and state',
    url: '/admin/flatmates',
    ready: /Flatmate/i,
    once: ['/api/admin/flatmates/moderation', '/api/admin/group-applications', '/api/admin/flatmate-reviews'],
    never: [],
    check: () => {},
  },
  {
    name: 'post-on-behalf downloads no pending-listing page',
    url: '/admin/post-on-behalf',
    ready: /Post on behalf|Owner/i,
    once: [],
    never: ['/api/admin/properties'],
    check: () => {},
  },
  {
    name: 'properties reads neither the owner-reply inbox nor the duplicate scan on load',
    url: '/admin/properties',
    ready: /To verify/,
    once: [],
    never: ['/api/admin/property-reviews', '/api/admin/properties/duplicates'],
    check: () => {},
  },
  {
    name: 'societies reads one summary and the open tab only',
    url: '/admin/societies',
    ready: /Claims/,
    once: ['/api/admin/societies/summary', '/api/admin/society-claims'],
    never: [
      '/api/admin/society-merges', '/api/admin/society-residents', '/api/admin/society-proposals',
      '/api/admin/society-candidates', '/api/societies',
    ],
    check: () => {},
  },
  {
    name: 'analytics reads the open tab\u2019s reports only',
    url: '/admin/analytics?tab=sla',
    ready: /Analytics/,
    once: ['/api/admin/analytics/sla'],
    never: [
      '/api/admin/analytics/traffic', '/api/admin/analytics/surfers', '/api/admin/analytics/engagement',
      '/api/admin/analytics/funnel', '/api/admin/analytics/pricing', '/api/admin/supply-gap', '/api/admin/cities/waitlist',
    ],
    check: () => {},
  },
];

for (const d of DESKS) {
  test(`an admin desk: ${d.name}`, async ({ page, login, consoleErrors }) => {
    await login.asAdmin();
    const gets = countGets(page);
    await page.goto(d.url);
    await expect(page.getByText(d.ready).first()).toBeVisible();
    await page.waitForTimeout(1000);

    for (const path of d.once) expect(gets.timesPath(path), path).toBe(1);
    for (const path of d.never) expect(gets.timesPath(path), path).toBe(0);
    d.check(gets);
    expect(consoleErrors).toEqual([]);
  });
}