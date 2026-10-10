import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, apiLogin, authHeaders, signIn, uniqueMobile } from '../../helpers/liveAuth.js';

const STAFFER = { mobile: '9383334640' };
const ROW_KEYS = ['id', 'type', 'status', 'details', 'assignee', 'assignedToMe', 'createdAt', 'amount', 'sla',
  'draftCheckStatus', 'policeConfirmed', 'approvedAt'];
const OWNER_PAN = 'ZZZQA1234Z';
const OWNER_AADHAAR = '999988887779';

async function seedValuation() {
  const { accessToken } = await apiLogin(uniqueMobile());
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };
  const property = `Payload desk flat ${Math.random().toString(36).slice(2, 8)}`;
  const created = await fetch(`${API}/service-requests`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ type: 'valuation', details: { ownerName: 'Payload Owner', property, purpose: 'Payload spec' } }),
  });
  const dto = await created.json();
  if (created.status >= 300) throw new Error(`create failed (${created.status}): ${JSON.stringify(dto)}`);
  const put = await fetch(`${API}/service-requests/${dto.id}/identities`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ parties: [{ partyRole: 'owner', partyIndex: 0, partyName: 'Payload Owner', pan: OWNER_PAN, aadhaar: OWNER_AADHAAR }] }),
  });
  if (put.status >= 300) throw new Error(`identities failed (${put.status}): ${await put.text()}`);
  return { id: dto.id, property };
}

function tracePaths(page) {
  const gets = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET') return;
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/')) gets.push(url.pathname + url.search);
  });
  return gets;
}

test('the queue read is a slim row with no files, parties, messages or payment session; the case is read on open', async () => {
  const { id } = await seedValuation();
  const headers = await authHeaders(ACTORS.admin);

  const res = await fetch(`${API}/service-requests/queue?team=valuation&q=${id}&size=5`, { headers });
  expect(res.status).toBe(200);
  const page = await res.json();
  const row = page.content.find((r) => r.id === id);
  expect(row, 'our request is on the valuation queue').toBeTruthy();
  expect(Object.keys(row).filter((k) => !ROW_KEYS.includes(k))).toEqual([]);
  expect(JSON.stringify(page)).not.toMatch(new RegExp(`${OWNER_PAN}|${OWNER_AADHAAR}|paymentSessionId|authorId`));

  const full = await (await fetch(`${API}/service-requests/${id}`, { headers })).json();
  expect(full.id).toBe(id);
  for (const doc of full.documents || []) expect(doc).not.toHaveProperty('url');

  const missing = await fetch(`${API}/service-requests/${id}/docs/00000000-0000-0000-0000-000000000000/url`, { headers });
  expect(missing.status).toBe(404);
});

test('a drafting desk reads the slim queue, opens one case with one read, and never lists the caller-scoped route', async ({ page }) => {
  test.slow();
  const { id, property } = await seedValuation();
  const gets = tracePaths(page);
  await signIn(page, STAFFER.mobile, { screen: 'staff' });
  await page.goto('/admin/valuation');
  const row = page.getByTestId('queue-row').filter({ hasText: property }).first();
  await expect(row).toBeVisible();

  expect(gets.some((p) => p.startsWith('/api/service-requests/queue?'))).toBe(true);
  expect(gets.filter((p) => /^\/api\/service-requests(\?|$)/.test(p))).toEqual([]);

  const before = gets.length;
  await row.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Take this request' })).toBeVisible();
  expect(gets.slice(before).filter((p) => p === `/api/service-requests/${id}`)).toHaveLength(1);
});

test('the rent desk polls the summary alone, pauses when hidden, and reads overlaps and refunds only for a case that shows them', async ({ page, login }) => {
  await login.asAdmin();
  const gets = tracePaths(page);
  await page.clock.install();
  await page.goto('/admin/rent-agreement');
  await expect(page.locator('[data-testid^="ra-count-"]').first()).toBeVisible();
  const summaries = () => gets.filter((p) => p.startsWith('/api/service-requests/queue-summary')).length;
  const lists = () => gets.filter((p) => p.startsWith('/api/service-requests/queue?')).length;
  expect(gets.some((p) => /\/(overlaps|refunds)(\?|$)/.test(p))).toBe(false);

  const baseSummaries = summaries();
  const baseLists = lists();
  await page.clock.fastForward(61_000);
  await expect.poll(summaries).toBeGreaterThan(baseSummaries);
  expect(lists()).toBeLessThanOrEqual(baseLists + 1);

  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  const hiddenAt = summaries();
  await page.clock.fastForward(61_000);
  await page.waitForTimeout(500);
  expect(summaries()).toBe(hiddenAt);
});

test('a service desk reads a ticket summary and one slim page, not the whole ticket list', async ({ page, login }) => {
  await login.asAdmin();
  const gets = tracePaths(page);
  await page.goto('/admin/home-loans');
  await expect(page.getByRole('heading', { name: /Home Loans/i }).first()).toBeVisible();
  await expect.poll(() => gets.filter((p) => p.startsWith('/api/tickets?')).length).toBeGreaterThan(0);

  const reads = gets.filter((p) => p.startsWith('/api/tickets?'));
  expect(reads.every((p) => /[?&]size=10(&|$)/.test(p))).toBe(true);
  expect(gets.filter((p) => p.startsWith('/api/tickets/summary'))).toHaveLength(1);
  expect(gets.filter((p) => /[?&]size=100(&|$)/.test(p) && p.startsWith('/api/tickets'))).toEqual([]);
});
