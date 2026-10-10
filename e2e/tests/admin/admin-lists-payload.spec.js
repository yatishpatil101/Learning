// Payload and request-count guards for the admin PII lists: users, enquiries/visits/deals, the bell and the palette.
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

const MASKED = /^\d{2}X{5}\d{3}$/;
const USER_ROW_KEYS = new Set([
  'id', 'name', 'mobile', 'role', 'status', 'verified', 'city', 'listingsCount', 'joinedAt',
  'flagged', 'flagReason', 'badgeSource', 'badgePending',
]);

function recordGets(page) {
  const seen = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' || !r.url().includes('/api/')) return;
    const url = new URL(r.url());
    seen.push(url.pathname + url.search);
  });
  return {
    withPath: (path) => seen.filter((k) => k.split('?')[0] === path),
    all: () => [...seen],
    reset: () => { seen.length = 0; },
  };
}

async function getJson(path) {
  const res = await fetch(`${API}${path}`, { headers: await authHeaders(ACTORS.admin) });
  expect(res.status, path).toBe(200);
  return res.json();
}

test('the users directory returns slim rows with a masked mobile, and a page flip does not recount', async ({ page, login, consoleErrors }) => {
  await test.step('the API rows carry only what the directory renders', async () => {
    const body = await getJson('/users?customers=true&size=20&counts=true');
    expect(body.content.length).toBeGreaterThan(0);
    for (const row of body.content) {
      expect(Object.keys(row).filter((k) => !USER_ROW_KEYS.has(k)), `unexpected keys on ${row.name}`).toEqual([]);
      if (row.mobile) expect(row.mobile).toMatch(MASKED);
    }
    expect(body.counts).toHaveProperty('badgePending');
  });

  await test.step('the page loads without the grants list and counts only once', async () => {
    await login.asAdmin();
    const gets = recordGets(page);
    await page.goto('/admin/users');
    await expect(page.getByTestId('queue-row').first()).toBeVisible();
    await page.waitForTimeout(500);

    expect(gets.withPath('/api/admin/badge-grants')).toEqual([]);
    const first = gets.withPath('/api/users');
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('counts=true');

    const before = gets.all().length;
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByTestId('queue-range').first()).toHaveText(/^21/);
    await page.waitForTimeout(800);
    const flipped = gets.all().slice(before).filter((k) => k.startsWith('/api/users'));
    expect(flipped, JSON.stringify(gets.all())).toHaveLength(1);
    expect(flipped[0]).not.toContain('counts=true');
    expect(consoleErrors).toHaveLength(0);
  });
});

test('enquiries, visits and deals page on the server with masked contacts and a summary read', async ({ page, login, consoleErrors }) => {
  await test.step('every list row masks the mobile, and the summary answers in whole-set numbers', async () => {
    for (const path of ['/admin/enquiries', '/admin/visits', '/admin/deals']) {
      const body = await getJson(`${path}?size=10`);
      for (const row of body.content) {
        for (const [key, value] of Object.entries(row)) {
          if (/mobile/i.test(key) && value) expect(value, `${path} ${key}`).toMatch(MASKED);
        }
      }
    }
    const summary = await getJson('/admin/enquiries/summary');
    expect(summary).toHaveProperty('enquiries');
    expect(summary).toHaveProperty('funnel.localities');
  });

  await test.step('the screen loads one summary and small pages, never a 100-row window', async () => {
    await login.asAdmin();
    const gets = recordGets(page);
    await page.goto('/admin/enquiries');
    await expect(page.getByTestId('queue-row').first()).toBeVisible();
    await page.waitForTimeout(500);

    expect(gets.withPath('/api/admin/enquiries/summary')).toHaveLength(1);
    const big = gets.all().filter((k) => /[?&]size=(50|100|200)(&|$)/.test(k));
    expect(big).toEqual([]);
    expect(gets.withPath('/api/admin/visits')).toEqual([]);
    expect(gets.withPath('/api/admin/deals')).toEqual([]);
    expect(consoleErrors).toHaveLength(0);
  });
});

test('the bell does not refetch on a route change, and the palette looks listings up through the slim endpoint', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  const gets = recordGets(page);
  await page.goto('/admin');
  await expect(page.getByLabel('Global search')).toBeVisible();
  await expect.poll(() => gets.withPath('/api/admin/bell').length).toBe(1);

  await page.goto('/admin');
  await page.locator('a[href="/admin/users"]').first().click();
  await page.waitForURL('**/admin/users');
  await page.waitForTimeout(500);
  expect(gets.withPath('/api/admin/bell').length).toBeLessThanOrEqual(2);

  const bell = await getJson('/admin/bell');
  for (const ticket of bell.openTickets?.items || []) {
    if (ticket.mobile) expect(ticket.mobile).toMatch(MASKED);
  }

  gets.reset();
  await page.getByLabel('Global search').fill('Baner');
  await expect(page.getByTestId('admin-palette')).toBeVisible();
  await expect.poll(() => gets.withPath('/api/admin/properties/lookup').length).toBeGreaterThan(0);
  expect(gets.withPath('/api/admin/properties')).toEqual([]);

  const lookup = await getJson('/admin/properties/lookup?q=Baner&size=6');
  for (const row of lookup.content) {
    expect(Object.keys(row).sort()).toEqual(['id', 'locality', 'owner', 'slug', 'status', 'title']);
  }
  expect(consoleErrors).toHaveLength(0);
});
