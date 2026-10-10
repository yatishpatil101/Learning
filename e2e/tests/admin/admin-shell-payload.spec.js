// Payload and request-count guards for the admin shell, settings, analytics, staff activity, audit log and team modal.
import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

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
    since: (n) => seen.slice(n),
  };
}

async function api(path, who = ACTORS.admin, init = {}) {
  return fetch(`${API}${path}`, { ...init, headers: await authHeaders(who) });
}

test('the shell reads the flags endpoint, never the whole settings document', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  const gets = recordGets(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.waitForTimeout(800);

  expect(gets.withPath('/api/admin/settings/flags')).toHaveLength(1);
  expect(gets.withPath('/api/admin/settings')).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('the flags read carries only the module switches, and a write acknowledges only what it wrote', async () => {
  const flags = await api('/admin/settings/flags');
  expect(flags.status).toBe(200);
  const body = await flags.json();
  expect(body).not.toHaveProperty('fees');
  expect(body).not.toHaveProperty('permissions');

  expect((await api('/admin/settings/flags', STAFF.rental)).status, 'staff read the tab switches').toBe(200);
  expect((await api('/admin/settings', STAFF.rental)).status, 'but not the whole document').toBe(403);
  expect((await fetch(`${API}/admin/settings/flags`)).status).toBe(401);

  const ack = await api('/admin/settings', ACTORS.admin, {
    method: 'PUT', body: JSON.stringify({ adminFlags: { content: { enabled: true } } }),
  });
  expect(ack.status).toBe(200);
  const written = await ack.json();
  expect(written.adminFlags.content.enabled).toBe(true);
  expect(Object.keys(written), 'the ack is the written block, not the document').toEqual(['adminFlags']);
});

test('the surfers report no longer repeats the weekly series the traffic report already carries', async () => {
  const surfers = await (await api('/admin/analytics/surfers?days=30')).json();
  expect(surfers).not.toHaveProperty('weeks');
  expect(surfers).toHaveProperty('pages');

  const traffic = await (await api('/admin/analytics/traffic?days=30')).json();
  expect(Array.isArray(traffic.identity)).toBe(true);
});

test('the staff feed omits unrendered actor ids, and managers get no metadata key', async () => {
  for (const who of [ACTORS.admin, ACTORS.manager]) {
    const res = await api('/admin/staff-activity?size=20', who);
    expect(res.status).toBe(200);
    for (const row of (await res.json()).content) {
      expect(row).not.toHaveProperty('actor');
      expect(row).not.toHaveProperty('actorTeam');
      if (who === ACTORS.manager) expect(row).not.toHaveProperty('metadata');
    }
  }
});

async function ensureTwoFeedPages() {
  for (let i = 0; i < 60; i += 1) {
    const probe = await (await api('/admin/staff-activity?size=1')).json();
    if (probe.totalElements > 50) return;
    await api('/admin/settings', ACTORS.admin, {
      method: 'PUT', body: JSON.stringify({ adminFlags: { content: { enabled: true } } }),
    });
  }
}

test('flipping the staff-activity page reads the feed alone', async ({ page, login }) => {
  await ensureTwoFeedPages();
  const probe = await (await api('/admin/staff-activity?size=1')).json();
  expect(probe.totalElements, 'the feed needs a second page to flip to').toBeGreaterThan(50);

  await login.asAdmin();
  const gets = recordGets(page);
  await page.goto('/admin/staff-activity?tab=log');
  await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(gets.withPath('/api/admin/staff-activity/summary').length).toBeGreaterThan(0);

  const before = gets.all().length;
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(/Page 2 of/)).toBeVisible();
  await page.waitForTimeout(800);
  const flipped = gets.since(before).filter((k) => k.startsWith('/api/admin/staff-activity'));
  expect(flipped, JSON.stringify(flipped)).toHaveLength(1);
  expect(flipped[0]).toContain('page=1');
});

test('the audit trail pages on the server, and exports the latest 100 only when asked', async ({ page, login }) => {
  await login.asAdmin();
  const gets = recordGets(page);
  await page.goto('/admin/staff-activity?tab=log');
  await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All actors', exact: true }).click();
  await expect(page.getByText('Audited actions by anyone, including customers and the system. Read-only.')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Record', exact: true })).toBeVisible();
  await page.waitForTimeout(500);

  const reads = gets.withPath('/api/admin/audit-log');
  expect(reads).toHaveLength(1);
  expect(reads[0]).toContain('size=12');
  expect(await page.locator('tbody tr').count()).toBeLessThanOrEqual(12);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await download;
  expect(gets.withPath('/api/admin/audit-log').some((k) => k.includes('size=100'))).toBe(true);
});

test('opening a staff member in the team modal reuses the roster and makes no permissions read', async ({ page, login }) => {
  const { id } = await login.scopeStaff('rental', ['kyc', 'desk:rental']);
  await login.asAdmin();
  const rosterRead = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/team' && r.request().method() === 'GET');
  const gets = recordGets(page);
  await page.goto('/admin/team');
  const member = (await (await rosterRead).json()).find((m) => m.id === id);
  expect(member?.functions?.length, 'the roster carries the scoped functions').toBeGreaterThan(0);

  await page.getByPlaceholder('Name, mobile or email').fill(member.name);
  const row = page.getByTestId('queue-row').filter({ hasText: member.name }).first();
  await expect(row).toBeVisible();
  const before = gets.all().length;
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit member' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /KYC/i }).first()).toBeChecked();
  await page.waitForTimeout(600);

  expect(gets.since(before).filter((k) => k.includes('/permissions'))).toEqual([]);
});