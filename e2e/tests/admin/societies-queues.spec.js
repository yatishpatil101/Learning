import { test, expect } from '../../fixtures/base.js';

/* `/admin/societies` — the three server-backed queues, and what the screen does when they fail.
 *
 * `admin/live-societies-directory.spec.js` covers this console on the happy path: the KPI strip, the
 * tabs, and the directory pager, against a real catalogue; the edit overlay is
 * `admin/live-society-admin.spec.js`. (Both replaced `admin/societies.spec.js`, which covered the
 * same ground in mock mode and could not tell a server pager from a client-side slice.) What none of
 * them can cover is the half of the
 * screen that only exists because the page moved off `localStorage` and onto the API seam (D242) —
 * a queue that *fails*, a decision that is *in flight*, and a decision that has *already been made*.
 * All three are network facts, and in mock mode the page makes no network calls at all, so
 * `page.route` has nothing to intercept.
 *
 * So this file does what `consumer/connectivity.spec.js` does: it rewrites `services/config.js` on
 * the way to the browser so that `society` (and, for the moderation tests, `report`) resolve to the
 * **http** provider for the life of one page, and then fault-injects the endpoints underneath. Every
 * test asserts `assertPatched()` afterwards, because a rewrite that silently stopped matching would
 * leave the app on mocks and every assertion below would be about a screen that never called a
 * server.
 *
 * The behaviour that earns the file is test 1. A failed queue used to render as **"No claim requests
 * yet."** — the most reassuring possible face for a fetch that never landed, on a screen whose only
 * job is to tell an operator whether there is work waiting. `reload()` now absorbs `ApiError` and
 * `NetworkError` per queue, names the ones that broke in a `role="alert"` banner, and offers a
 * Retry; the counts above it are disclosed as wrong in the same sentence. The assertion pairs the
 * banner with the KPI still reading 0, because the zero is exactly the lie the banner exists to
 * label.
 *
 * WHY THERE IS NO `consoleErrors` ASSERTION. These tests fulfil real 500s on the app's own origin,
 * which the browser logs as console errors by design, and `helpers/console.js` judges failed
 * requests by origin rather than by intent. Asserting an empty console here would mean asserting
 * that the injected failure did not happen. `admin/live-societies-directory.spec.js` keeps that
 * guarantee for the clean load.
 *
 * Source: `pages/admin/AdminSocieties.jsx` (reload/safe/withDeciding/decideClaim/decideReport),
 * `pages/admin/societies/ClaimsTab.jsx` (decisionCell), `pages/admin/societies/ModerationTab.jsx`,
 * `services/providers/http/societyProvider.js`, `services/providers/http/reportMapper.js`.
 * Guards (`RoleRoute roles={['admin']}`, `ModuleRoute moduleKey="societies"`) are asserted in
 * `admin/live-societies-directory.spec.js`, at the router and at the API both, and deliberately not
 * repeated here.
 */

/* Playwright globs: `*` does not cross a `/`, so the collection and the item would need two
   patterns. One `**` pattern per resource with a method branch inside is less to get wrong. */
const CLAIMS = '**/api/admin/society-claims**';
const PROPOSALS = '**/api/admin/society-proposals**';
const REPORTS = '**/api/reports**';
/* The three queues this file never fault-injects, and which nevertheless have to be answered. See
   `stubQuietQueues` for why an unrouted read is not neutral here. */
const RESIDENTS = '**/api/admin/society-residents**';
const CANDIDATES = '**/api/admin/society-candidates**';
const MERGES = '**/api/admin/society-merges**';

/** A Spring `PageResponse`, the shape `unwrapFullPage` reads. */
const pageOf = (rows) => ({ content: rows, page: 0, size: 100, totalElements: rows.length, totalPages: 1 });

const json = (status, payload) => ({ status, contentType: 'application/json', body: JSON.stringify(payload) });
/** The error envelope `http.js#toResult` reads: `error` → `code`, `message` → `err.message`. */
const boom = (message) => json(500, { error: 'internal_error', message, traceId: 'e2e-societies' });

/* One `SocietyClaimResponse` on the wire. There is no claim mapper — `listSocietyClaimQueue`
   unwraps the page and hands the rows straight to `ClaimsTab` — so these are the server's own field
   names from `SocietyClaimResponse.java`, not a fixture vocabulary. */
const claim = (over = {}) => ({
  id: 'c1a2b3c4-0000-4000-8000-000000000001',
  societySlug: 'e2e-claim-queue-heights',
  societyName: 'E2E Claim Queue Heights',
  claimantName: 'Anita Kulkarni',
  claimantMobile: '9812345670',
  role: 'Secretary',
  email: 'anita.kulkarni@example.com',
  note: 'On the committee since 2019.',
  status: 'pending',
  createdAt: '2026-08-01T12:00:00Z',
  decidedAt: null,
  ...over,
});

/* One wire `Report`. `targetType` is the prefixed form (`society_contribution`), because the queue
   is narrowed by `SOCIETY_REPORT_KINDS` on the *client* word — routing the round trip through
   `reportMapper.toViewModel` is the point: a fixture written in client vocabulary would render
   while the mapping it depends on was broken. */
const report = (over = {}) => ({
  id: 'r1a2b3c4-0000-4000-8000-000000000009',
  targetType: 'society_contribution',
  targetId: 'e2e-contribution-000009',
  reason: 'spam',
  details: 'Posting the same broker advert every morning.',
  status: 'open',
  createdAt: '2026-08-02T12:00:00Z',
  ...over,
});

/**
 * Put one or more domains onto the http seam for this page only.
 *
 * Lifted from `consumer/connectivity.spec.js`. The conditional headers are stripped because Vite
 * answers 304 to a warm reload, and a 304 has no body to rewrite; the response is returned
 * `no-store` so a second navigation in the same test re-runs this handler rather than replaying a
 * cached unpatched module.
 *
 * @returns {() => void} call **after** navigating — asserts the rewrite actually happened.
 */
async function goLive(page, domains) {
  let patched = false;
  await page.route(/\/src\/services\/config\.js(\?.*)?$/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    const res = await route.fetch({ headers });
    const source = await res.text();
    const next = source.replace(/const RAW_DOMAINS = [^;]*;/, `const RAW_DOMAINS = '${domains}';`);
    patched = next !== source;
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' },
      body: next,
    });
  });
  await stubQuietQueues(page);
  return () => expect(
    patched,
    'services/config.js was never rewritten — the app is still on mocks, so this test would assert nothing',
  ).toBe(true);
}

/**
 * Answer the society queues this file has no claim about, so that the only failure on screen is the
 * one a test injected.
 *
 * The seam is per **domain**, not per endpoint: `goLive(page, 'society')` moves every society read
 * onto http, including the four `reload()` fires that no test here stubs. In mock mode there is no
 * backend behind the dev proxy, so those reads do not quietly return nothing — they raise
 * `NetworkError`, and `AdminSocieties.reload()` collects the label of every queue that broke into
 * one banner. Three uninteresting failures therefore rewrite the sentence test 1 asserts, from the
 * singular branch it was written against to the plural one, and take with them the distinction that
 * test exists to draw. That is not hypothetical: it is how this file broke, and it broke silently in
 * the five tests that only need the banner to be *absent* from their own assertions.
 *
 * Empty pages rather than rows, deliberately. Nothing below reads a resident, candidate or merge, so
 * inventing fixtures for them would be three more wire shapes to keep in step with the server for no
 * assertion; an empty queue is the one answer that cannot be wrong about them.
 *
 * `listReports` is not here — it is a `report`-domain read, so it stays on mocks unless a test asks
 * for that domain too, and the two that do stub it themselves.
 */
async function stubQuietQueues(page) {
  for (const pattern of [RESIDENTS, CANDIDATES, MERGES]) {
    await page.route(pattern, (route) => route.fulfill(json(200, pageOf([]))));
  }
}

/**
 * The claim queue and the claim decision, both under the test's control.
 *
 * `listStatus` flips the GET between 200 and 500 mid-test (that is what Retry is for). `gate`, when
 * set to a pending promise, holds the PATCH open so the in-flight window can be asserted rather
 * than raced. `patches` is the record that makes "exactly one decision was sent" assertable.
 */
async function stubClaims(page) {
  const state = { rows: [], listStatus: 200, patchStatus: 200, patchMessage: '', gate: null, lists: 0, patches: [] };
  await page.route(CLAIMS, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      state.lists += 1;
      if (state.listStatus !== 200) return route.fulfill(boom('Injected claim-queue failure'));
      return route.fulfill(json(200, pageOf(state.rows)));
    }
    state.patches.push({ url: req.url(), body: req.postDataJSON() });
    if (state.gate) await state.gate;
    if (state.patchStatus !== 200) {
      return route.fulfill(json(state.patchStatus, { error: 'conflict', message: state.patchMessage }));
    }
    const id = req.url().split('/').pop();
    return route.fulfill(json(200, claim({ id, status: req.postDataJSON()?.status, decidedAt: '2026-08-05T12:00:00Z' })));
  });
  return state;
}

/** The proposal queue — three panels' worth of rows, empty unless a test says otherwise. */
async function stubProposals(page) {
  const state = { rows: [], listStatus: 200 };
  await page.route(PROPOSALS, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill(json(200, {}));
    if (state.listStatus !== 200) return route.fulfill(boom('Injected proposal-queue failure'));
    return route.fulfill(json(200, pageOf(state.rows)));
  });
  return state;
}

/**
 * The report queue. `listReports` is called twice per reload — once for `open`, once for
 * `reviewing` — so the handler branches on the status the request actually carries; answering both
 * from one list would double every row on screen.
 */
async function stubReports(page) {
  const state = { open: [], reviewing: [], patches: [] };
  await page.route(REPORTS, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      const status = new URL(req.url()).searchParams.get('status');
      return route.fulfill(json(200, pageOf(status === 'reviewing' ? state.reviewing : state.open)));
    }
    const id = req.url().split('/').pop();
    state.patches.push({ id, body: req.postDataJSON() });
    // The decision is what removes the row from the *open* queue; the reload behind it re-reads.
    state.open = state.open.filter((r) => r.id !== id);
    return route.fulfill(json(200, { ...report({ id }), status: req.postDataJSON()?.status }));
  });
  return state;
}

/* `role="alert"` is worn by both the queue banner and every toast, so nothing in this file may use
   the bare role — a decision toast and a failed queue would collide in strict mode, and the one
   that won would be a DOM-order accident. */
const banner = (page) => page.getByRole('alert').filter({ hasText: 'could not be' });
const toast = (page, text) => page.getByRole('alert').filter({ hasText: text });
/* Scoped to the desktop `<table>`: `Table` renders its rows twice, once as a `.pn-card` stack. */
const claimsTable = (page) => page.getByRole('table');
const claimRow = (page, name) => claimsTable(page).getByRole('row').filter({ hasText: name });
/** The number inside a KPI tile, so "1" cannot be satisfied by a "12" somewhere else in the card. */
const kpi = (page, label) => page.locator('.pn-card').filter({ hasText: label }).first().locator('.text-2xl');

async function openSocieties(page, query = '') {
  await page.goto('/admin/societies' + query);
  await expect(page.getByRole('button', { name: 'Claims' })).toBeVisible();
}

test('a claims queue that fails to load says so, instead of reporting an empty queue', async ({ page, login }) => {
  const assertPatched = await goLive(page, 'society');
  const claims = await stubClaims(page);
  await stubProposals(page);
  claims.listStatus = 500;

  await login.asAdmin();
  await openSocieties(page);
  assertPatched();

  /* Verbatim from `AdminSocieties.jsx`. Singular throughout, because only one queue was failed —
     the plural branch is a different sentence and asserting the loose half would let "The claims
     and reports queues" pass here. */
  await expect(banner(page)).toContainText(
    'The claims queue could not be loaded, so that tab is showing nothing rather than nothing to do.'
    + ' The counts above are wrong for the same reason.',
  );
  await expect(banner(page).getByRole('button', { name: 'Retry' })).toBeVisible();
  /* The pairing is the assertion. The tile says there is no work waiting and the table says the
     same thing, and both are wrong — the banner is the only thing on screen that is not. */
  await expect(kpi(page, 'Pending claims')).toHaveText('0');
  await expect(claimsTable(page)).toContainText('No claim requests yet.');
  expect(claims.lists, 'the queue was never requested — the app is not on the http seam').toBeGreaterThan(0);

  // Retry is a real re-fetch, not a cosmetic dismissal: fix the server and the work appears.
  claims.listStatus = 200;
  claims.rows = [claim()];
  await banner(page).getByRole('button', { name: 'Retry' }).click();

  await expect(banner(page)).toHaveCount(0);
  await expect(claimRow(page, 'E2E Claim Queue Heights')).toContainText('Anita Kulkarni');
  await expect(kpi(page, 'Pending claims')).toHaveText('1');
});

test('a decision in flight disables both buttons and cannot be sent twice', async ({ page, login }) => {
  const assertPatched = await goLive(page, 'society');
  const claims = await stubClaims(page);
  await stubProposals(page);
  claims.rows = [claim()];

  let release;
  claims.gate = new Promise((resolve) => { release = resolve; });

  await login.asAdmin();
  await openSocieties(page);
  assertPatched();

  const row = claimRow(page, 'E2E Claim Queue Heights');
  const approve = row.getByRole('button', { name: 'Approve' });
  const reject = row.getByRole('button', { name: 'Reject' });
  await approve.click();

  /* Both, not just the one clicked: rejecting a claim whose approval is already in flight is the
     same 409 by another route, and the queue's other rows must stay actionable — `deciding` is a
     Set of ids for exactly that reason. */
  await expect(approve).toBeDisabled();
  await expect(reject).toBeDisabled();
  await expect(claimRow(page, 'E2E Claim Queue Heights').getByRole('button', { name: 'Approve' })).toBeDisabled();

  /* Dispatched rather than clicked, so the assertion is about the guard and not about Playwright
     declining to click a disabled button. `decidingRef` is checked synchronously precisely because
     the `disabled` attribute is a paint behind the click. */
  await approve.dispatchEvent('click');
  await reject.dispatchEvent('click');

  claims.rows = []; // the decided row leaves the pending queue the reload re-reads
  release();

  await expect(toast(page, 'Society claim approved')).toBeVisible();
  expect(claims.patches).toHaveLength(1);
  expect(claims.patches[0].body).toEqual({ status: 'approved' });
  expect(claims.patches[0].url).toContain('/api/admin/society-claims/c1a2b3c4-0000-4000-8000-000000000001');
  await expect(claimsTable(page)).toContainText('No claim requests yet.');
  await expect(kpi(page, 'Pending claims')).toHaveText('0');
});

test('a decided claim is not offered a second decision, while its pending neighbour still is', async ({ page, login }) => {
  const assertPatched = await goLive(page, 'society');
  const claims = await stubClaims(page);
  await stubProposals(page);
  /* The page asks for `status=pending`, so in production wiring a decided row does not come back at
     all — this fixture forces the row-level branch, which is the one that has to hold when it does:
     an operator reading a filtered queue and an operator reading a stale tab must not be offered
     different powers over the same claim. */
  claims.rows = [
    claim(),
    claim({
      id: 'c1a2b3c4-0000-4000-8000-000000000002',
      societySlug: 'e2e-already-decided-court',
      societyName: 'E2E Already Decided Court',
      claimantName: 'Rohit Deshpande',
      status: 'approved',
      decidedAt: '2026-08-04T12:00:00Z',
    }),
  ];

  await login.asAdmin();
  await openSocieties(page);
  assertPatched();

  const decided = claimRow(page, 'E2E Already Decided Court');
  await expect(decided).toContainText(/Decided \d{1,2} \w{3}/);
  await expect(decided.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(decided.getByRole('button', { name: 'Reject' })).toHaveCount(0);

  const pending = claimRow(page, 'E2E Claim Queue Heights');
  await expect(pending.getByRole('button', { name: 'Approve' })).toBeEnabled();
  await expect(pending.getByRole('button', { name: 'Reject' })).toBeEnabled();
});

test('a claim the server has already decided reports the refusal in the server words, and keeps the row', async ({ page, login }) => {
  const assertPatched = await goLive(page, 'society');
  const claims = await stubClaims(page);
  await stubProposals(page);
  claims.rows = [claim()];
  claims.patchStatus = 409;
  claims.patchMessage = 'This claim has already been decided.';

  await login.asAdmin();
  await openSocieties(page);
  assertPatched();

  const row = claimRow(page, 'E2E Claim Queue Heights');
  await row.getByRole('button', { name: 'Approve' }).click();

  /* The server's sentence, not `failed()`'s fallback: "Could not record that decision." would leave
     the operator re-clicking a button that can never work. */
  await expect(toast(page, 'This claim has already been decided.')).toBeVisible();
  await expect(toast(page, 'Could not record that decision.')).toHaveCount(0);
  await expect(toast(page, 'Society claim approved')).toHaveCount(0);
  // A refused decision is not a decision: the row stays, and stays actionable.
  await expect(row).toContainText('Pending');
  await expect(row.getByRole('button', { name: 'Approve' })).toBeEnabled();
  expect(claims.patches).toHaveLength(1);
});

test('the moderation tab lists a reported society post and dismissing it closes the report', async ({ page, login }) => {
  const assertPatched = await goLive(page, 'society,report');
  await stubClaims(page);
  await stubProposals(page);
  const reports = await stubReports(page);
  reports.open = [report()];

  await login.asAdmin();
  await openSocieties(page, '?tab=moderation');
  assertPatched();

  /* Everything asserted here is produced by `reportMapper.toViewModel`: the wire's
     `society_contribution` becomes the client kind `contribution`, which `REPORT_LABELS` renders as
     "Community post", and `spam` is resolved against the *society* vocabulary rather than the
     listing one ("Spam, advertising or a duplicate post", not "Duplicate listing"). */
  await expect(page.getByRole('heading', { name: 'Reported content (1)' })).toBeVisible();
  const card = page.getByRole('listitem').filter({ hasText: 'e2e-contribution-000009' });
  await expect(card).toContainText('Community post');
  await expect(card).toContainText('Reason: Spam, advertising or a duplicate post');
  await expect(card).toContainText('Posting the same broker advert every morning.');

  await card.getByRole('button', { name: 'Dismiss' }).click();

  // `\u2014` rather than a literal em dash, so the assertion cannot be broken by an encoding round trip.
  await expect(toast(page, 'Report dismissed \u2014 content kept')).toBeVisible();
  expect(reports.patches).toHaveLength(1);
  expect(reports.patches[0].body).toEqual({ status: 'dismissed' });
  await expect(page.getByRole('heading', { name: 'Reported content (0)' })).toBeVisible();
  await expect(page.getByText('No open reports. Resident flags on society posts land here.')).toBeVisible();
});

test('removing reported content sends the enforcement as well as the status', async ({ page, login }) => {
  const assertPatched = await goLive(page, 'society,report');
  await stubClaims(page);
  await stubProposals(page);
  const reports = await stubReports(page);
  reports.open = [report()];

  await login.asAdmin();
  await openSocieties(page, '?tab=moderation');
  assertPatched();

  const card = page.getByRole('listitem').filter({ hasText: 'e2e-contribution-000009' });
  await card.getByRole('button', { name: 'Remove content' }).click();

  /* Two facts, not one. `{ status: 'actioned' }` alone closes the complaint and leaves the post up —
     the queue then reads as handled while the thing that was reported is still on the hub, which is
     what the old buttons did. */
  await expect(toast(page, 'Content removed & report closed')).toBeVisible();
  expect(reports.patches).toHaveLength(1);
  expect(reports.patches[0].body).toEqual({ status: 'actioned', enforcement: 'hide_content' });
  await expect(page.getByRole('heading', { name: 'Reported content (0)' })).toBeVisible();
});
