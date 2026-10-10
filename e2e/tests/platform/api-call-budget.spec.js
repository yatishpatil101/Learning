import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, apiLogin, authHeaders, signedInAs, uniqueMobile, uploadedListingPhotos } from '../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../helpers/moderation.js';

/** Request budget on load: public config is one GET /bootstrap, dashboard/owner hub use one GET /me/dashboard
 * that primes per-section reads, and similar listings (ranked server-side) load only when scrolled near. */

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
  '/api/me/service-request-invites', '/api/me/managed-properties', '/api/me/entitlements',
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

const OWNER_INBOXES = [
  '/api/me/contact-requests', '/api/me/photo-requests', '/api/me/documents/requests',
  '/api/me/group-applications', '/api/me/property-reviews', '/api/me/tenancies', '/api/me/service-request-invites',
];

test('a seeker dashboard carries rental flags, not tenancies, and never reads or refreshes the owner inboxes', async ({ page, login, consoleErrors }) => {
  await login.asBuyer();
  const gets = countGets(page);
  const dashboardRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/me/dashboard');
  await page.goto('/dashboard');
  const body = await (await dashboardRead).json();

  expect(body.listings.content).toEqual([]);
  for (const key of ['tenancies', 'serviceRequestInvites', 'entitlements', 'deals']) expect(key in body, key).toBe(false);
  expect(typeof body.hasTenancy).toBe('boolean');
  expect(typeof body.hasRentalInvite).toBe('boolean');

  // Past the seeds' 5s window, so the tab-return refresh goes to the network.
  await page.waitForTimeout(6000);
  const visitsBefore = gets.timesPath('/api/visits');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => gets.timesPath('/api/visits')).toBeGreaterThan(visitsBefore);
  await page.waitForTimeout(1000);
  for (const path of OWNER_INBOXES) expect(gets.timesPath(path), path).toBe(0);
  expect(consoleErrors).toEqual([]);
});

test('a signed-in property page asks for its own visits, not the whole list', async ({ page, login, consoleErrors }) => {
  await login.asBuyer();
  const visitsRead = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/visits');
  await page.goto('/property/p5000');
  await page.getByRole('tab', { name: /^Amenities/ }).click();
  expect(new URL((await visitsRead).url()).searchParams.get('propertyId')).toMatch(/^[0-9a-f-]{36}$/);
  expect(consoleErrors).toEqual([]);
});

test('the flatmates board reads interest keys, not the hydrated outbox', async ({ page, login, consoleErrors }) => {
  await login.asBuyer();
  const gets = countGets(page);
  const keysRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/me/flatmate-interests/keys');
  await page.goto('/flatmates');
  const keys = await (await keysRead).json();
  for (const row of keys) expect(Object.keys(row).sort()).toEqual(['id', 'kind', 'status', 'targetId']);
  expect(gets.timesPath('/api/me/flatmate-interests')).toBe(0);
  expect(consoleErrors).toEqual([]);
});
test.describe('similar listings', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('load only once the visitor scrolls near them', async ({ page, consoleErrors }) => {
    const gets = countGets(page);
    const isSimilarRead = (key) => key.startsWith('/api/properties/similar?');

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

for (const [name, url, readyText, roster] of [['the team page', '/admin/team', /Team/, '/api/admin/team'], ['a service desk', '/admin/home-loans', /Home Loans/i, '/api/admin/team/assignees']]) {
  test(`${name} reads the back-office roster once, from ${roster}`, async ({ page, login, consoleErrors }) => {
    await login.asAdmin();
    const gets = countGets(page);
    const rosterRead = page.waitForResponse((r) => new URL(r.url()).pathname === roster);
    await page.goto(url);
    await rosterRead;
    await expect(page.getByText(readyText).first()).toBeVisible();
    await page.waitForTimeout(1000);

    expect(gets.timesPath(roster)).toBe(1);
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
  for (const path of ['/api/admin/properties', '/api/tickets']) {
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
    name: 'users reads one paged list that carries the counts, and leaves badge grants to the badges tab',
    url: '/admin/users',
    ready: /Users|Customers/,
    once: ['/api/users'],
    never: ['/api/admin/badge-grants'],
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
    name: 'properties does not run the duplicate scan on load',
    url: '/admin/properties',
    ready: /To verify/,
    once: [],
    never: ['/api/admin/properties/duplicates'],
    check: () => {},
  },
  {
    name: 'societies reads one summary and the open tab only',
    url: '/admin/societies',
    ready: /Candidates/,
    once: ['/api/admin/societies/summary', '/api/admin/society-candidates', '/api/admin/society-merges'],
    never: [
      '/api/admin/society-claims', '/api/admin/society-residents', '/api/admin/society-proposals', '/api/societies',
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

test('My Listings draws its chips from the listing rows and a row action re-reads nothing', async ({ page, consoleErrors }) => {
  const mobile = uniqueMobile();
  const owner = await apiLogin(mobile);
  const created = await fetch(`${API}/me/listings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` },
    body: JSON.stringify({
      title: `Zztest budget listing ${Date.now()}`, deal: 'rent', propertyType: 'Flat', bhk: 2, price: 26000, area: 850,
      city: 'Pune', locality: 'Baner', images: await uploadedListingPhotos(owner),
    }),
  });
  expect(created.status).toBe(201);
  const { id } = await created.json();
  try {
    expect((await approveListingWithFetch(id, await authHeaders(ACTORS.admin))).status).toBe(200);

    await signedInAs(page, mobile);
    const calls = [];
    page.on('request', (r) => { if (r.url().includes('/api/')) calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    const dashboardRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/me/dashboard');
    await page.goto('/dashboard#listings');
    const rows = (await (await dashboardRead).json()).listings.content;
    expect(rows.find((l) => l.id === id)).toMatchObject({ pendingLeads: 0 });
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.waitForTimeout(1500);

    const reads = (path) => calls.filter((c) => c.startsWith('GET ') && c.slice(4) === path).length;
    for (const path of ['/api/me/listings', '/api/me/contact-requests', '/api/me/flatmate-rooms', '/api/me/managed-properties']) {
      expect(reads(path), path).toBe(0);
    }

    const before = calls.length;
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(calls.slice(before).filter((c) => c.startsWith('GET ') && /\/api\/me\/(listings|contact-requests|deals|dashboard)/.test(c))).toEqual([]);
    expect(calls.slice(before).filter((c) => c.startsWith('POST ')).length).toBe(1);
    expect(consoleErrors).toEqual([]);
  } finally {
    await rejectListingWithFetch(id, await authHeaders(ACTORS.admin), { reason: 'Zztest cleanup - api call budget' });
  }
});

test('an owner create, edit and take-down answer identity and verdict only, and the wizard reads two numbers for its quota', async ({ page, consoleErrors }) => {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const owner = await apiLogin(mobile);
  const send = async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const WRITE_KEYS = ['id', 'slug', 'status', 'archived', 'recheckPending', 'recheckReason', 'recheckRequestedAt'];
  const created = await send('POST', '/me/listings', {
    title: `Zztest slim write ${Date.now()}`, deal: 'rent', propertyType: 'Flat', bhk: 2, price: 26000, area: 850,
    city: 'Pune', locality: 'Baner', images: await uploadedListingPhotos(owner),
  });
  expect(created.status).toBe(201);
  expect(Object.keys(created.body).filter((k) => !WRITE_KEYS.includes(k))).toEqual([]);
  const id = created.body.id;

  const edited = await send('PATCH', `/me/listings/${id}`, { description: 'A bright flat close to the metro, newly painted.' });
  expect(edited.status).toBe(200);
  expect(Object.keys(edited.body).filter((k) => !WRITE_KEYS.includes(k))).toEqual([]);
  expect(edited.body.status).toBe('pending');

  const whole = await send('GET', `/me/listings/${id}`);
  expect(whole.body.description).toBe('A bright flat close to the metro, newly painted.');

  await signedInAs(page, mobile);
  const gets = countGets(page);
  const quotaRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/me/listings/quota');
  await page.goto('/list-property');
  const quota = await (await quotaRead).json();
  expect(Object.keys(quota).sort()).toEqual(['allowance', 'used']);
  expect(quota.used).toBe(1);
  await page.waitForTimeout(1500);
  expect(gets.timesPath('/api/me/listings/quota')).toBe(1);
  expect(gets.timesPath('/api/me/entitlements')).toBe(0);
  expect(consoleErrors).toEqual([]);

  const taken = await send('DELETE', `/me/listings/${id}`);
  expect(taken.status).toBe(200);
  expect(Object.keys(taken.body).filter((k) => !WRITE_KEYS.includes(k))).toEqual([]);
  expect(taken.body.archived).toBe(true);
});