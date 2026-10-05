/**
 * The society desk's failure, in-flight and already-decided states, staged against the live desk.
 *
 * `/admin/societies` reads five queues from the API. Three things can be true of a row or a queue
 * that no seeded happy path reaches: the fetch failed, a decision is on the wire, or somebody
 * decided it first. Each is a place where the screen could say something reassuring and false, so
 * each is asserted here with real rows filed over the API and the fault injected underneath the
 * page. A fulfilled 500 is a real response on the app's own origin, so there is deliberately no
 * `consoleErrors` assertion: an empty console would mean the failure never happened.
 */
import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';
import { mintSociety } from '../../helpers/liveSociety.js';

const CLAIMS_LIST = /\/api\/admin\/society-claims(\?|$)/;
const claimUrl = (id) => new RegExp(`/api/admin/society-claims/${id}$`);

const rows = (page) => page.locator('table tbody tr');
const rowFor = (page, name) => rows(page).filter({ hasText: name });
const kpi = (page, label) => page.getByText(label, { exact: true }).locator('xpath=following-sibling::div[1]');

const admin = async () => authHeaders('9000000000');

async function society(request, label) {
  const claimant = uniqueMobile();
  const slug = await mintSociety(request, claimant, label);
  const named = await request.get(`${API}/societies/${slug}`);
  return { claimant, slug, name: (await named.json()).name };
}

async function fileClaim(request, label) {
  const s = await society(request, label);
  const res = await request.post(`${API}/societies/${s.slug}/claim`, {
    headers: await authHeaders(s.claimant),
    data: { name: 'Anita Deshpande', role: 'Chairperson', note: `Committee elected in March. ${label}` },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return { ...s, id: (await res.json()).id };
}

async function claimsWith(request, status) {
  const res = await request.get(`${API}/admin/society-claims?status=${status}&size=100`, { headers: await admin() });
  expect(res.status()).toBe(200);
  return (await res.json()).content;
}

async function claimStatus(request, id) {
  for (const status of ['pending', 'approved', 'rejected']) {
    const found = (await claimsWith(request, status)).find((c) => c.id === id);
    if (found) return found.status;
  }
  return null;
}

const decide = async (request, id, status) =>
  request.patch(`${API}/admin/society-claims/${id}`, { headers: await admin(), data: { status } });

test('a claims queue that fails says so beside a tile still reading 0, and Retry really re-reads it', async ({ page, request, login }) => {
  const filed = await fileClaim(request, 'Failing queue');

  await login.asAdmin();
  await page.route(CLAIMS_LIST, (route) => (route.request().method() === 'GET'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'boom' }) })
    : route.fallback()));
  await page.goto('/admin/societies?tab=claims');
  await expect(page.getByRole('heading', { name: 'Societies', exact: true })).toBeVisible();

  const banner = page.getByRole('alert').filter({ hasText: /claims queue could not be\s+loaded/ });
  await expect(banner).toBeVisible();
  await expect(kpi(page, 'Pending claims'), 'the tile is the zero the banner exists to label').toHaveText('0');
  await expect(rowFor(page, filed.name)).toHaveCount(0);

  await page.unroute(CLAIMS_LIST);
  const reread = page.waitForResponse((r) => CLAIMS_LIST.test(r.url()) && r.request().method() === 'GET' && r.status() === 200);
  await banner.getByRole('button', { name: 'Retry' }).click();
  await reread;

  await expect(banner).toHaveCount(0);
  await expect(rowFor(page, filed.name)).toHaveCount(1);
  await expect(kpi(page, 'Pending claims')).toHaveText(/^[1-9]\d*$/);
});

test('both buttons on a row disable while its own PATCH is in flight, and a second click sends no second decision', async ({ page, request, login }) => {
  const held = await fileClaim(request, 'In flight');
  const neighbour = await fileClaim(request, 'Neighbour');

  await login.asAdmin();
  const sent = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(claimUrl(held.id), async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    sent.push(route.request().postDataJSON());
    await gate;
    return route.continue();
  });
  await page.goto('/admin/societies?tab=claims');
  const row = rowFor(page, held.name);
  await expect(row).toHaveCount(1);

  // Both clicks land in one task, before React re-renders the button disabled, so only the handler's in-flight guard can stop the second.
  await row.getByRole('button', { name: 'Approve' }).evaluate((b) => { b.click(); b.click(); });
  await expect(row.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(row.getByRole('button', { name: 'Reject' })).toBeDisabled();
  await expect(rowFor(page, neighbour.name).getByRole('button', { name: 'Approve' }), "one row's decision does not grey out the queue").toBeEnabled();
  await expect(rowFor(page, neighbour.name).getByRole('button', { name: 'Reject' })).toBeEnabled();
  await expect.poll(() => sent, { message: 'no second decision left the browser' }).toEqual([{ status: 'approved' }]);
  expect(await claimStatus(request, held.id), 'nothing is decided until the held PATCH lands').toBe('pending');

  release();
  await expect(page.getByText('Society claim approved')).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(sent).toHaveLength(1);
  expect(await claimStatus(request, held.id)).toBe('approved');
  expect(await claimStatus(request, neighbour.id)).toBe('pending');
  await expect(rowFor(page, neighbour.name).getByRole('button', { name: 'Approve' })).toBeEnabled();
});

test('a decided row shows when it was decided while its pending neighbour keeps its buttons', async ({ page, request, login }) => {
  const done = await fileClaim(request, 'Decided row');
  const waiting = await fileClaim(request, 'Waiting row');
  expect((await decide(request, done.id, 'rejected')).status()).toBe(200);
  const decided = (await claimsWith(request, 'rejected')).find((c) => c.id === done.id);
  expect(decided.decidedAt, 'the server stamped the decision').toBeTruthy();

  await login.asAdmin();
  // The live queue asks for pending only, so a decided row is only reachable by adding the real one to that answer.
  await page.route(CLAIMS_LIST, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const real = await route.fetch();
    const body = await real.json();
    return route.fulfill({ response: real, json: { ...body, content: [...body.content, decided] } });
  });
  await page.goto('/admin/societies?tab=claims');

  const decidedRow = rowFor(page, done.name);
  await expect(decidedRow).toHaveCount(1);
  await expect(decidedRow).toContainText(/Decided \d{1,2} \w{3}/);
  await expect(decidedRow.getByText('Rejected', { exact: true })).toBeVisible();
  await expect(decidedRow.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(decidedRow.getByRole('button', { name: 'Reject' })).toHaveCount(0);

  const pendingRow = rowFor(page, waiting.name);
  await expect(pendingRow).not.toContainText('Decided');
  await expect(pendingRow.getByRole('button', { name: 'Approve' })).toBeEnabled();
  await expect(pendingRow.getByRole('button', { name: 'Reject' })).toBeEnabled();
});

test('a 409 shows the server\'s sentence and leaves the row pending and actionable', async ({ page, request, login }) => {
  const claim = await fileClaim(request, 'Lost the race');

  await login.asAdmin();
  await page.goto('/admin/societies?tab=claims');
  const row = rowFor(page, claim.name);
  await expect(row.getByRole('button', { name: 'Approve' })).toBeEnabled();

  expect((await decide(request, claim.id, 'rejected')).status(), 'a colleague decides it first').toBe(200);

  const refused = page.waitForResponse((r) => claimUrl(claim.id).test(r.url()) && r.request().method() === 'PATCH');
  await row.getByRole('button', { name: 'Approve' }).click();
  expect((await refused).status()).toBe(409);

  await expect(page.getByText('This claim has already been decided.')).toBeVisible();
  await expect(page.getByText('Could not record that decision.')).toHaveCount(0);
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('button', { name: 'Approve' })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Reject' })).toBeEnabled();
  expect(await claimStatus(request, claim.id), "the stale click did not overwrite the colleague's decision").toBe('rejected');
});
