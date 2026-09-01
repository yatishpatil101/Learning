/**
 * The Pricing and SLA analytics tabs, against the live API.
 *
 * ## Why only two of the eight tabs are here
 *
 * `admin/analytics.spec.js` covers all eight, but it runs on the mock config, and for six of those
 * tabs that is the only honest place to run them: Traffic, Engagement, Anonymous surfers and
 * Seasonal are generated in the browser and have no server to talk to, and Geography and Supply Gap
 * already have live coverage of their own endpoints elsewhere. Pricing and SLA are the two that
 * newly read the API, so they are the two that need asserting against a real database.
 *
 * Running the whole mock file under `playwright.live.config.js` would have executed six
 * localStorage-backed tabs under a filename claiming otherwise, which is the failure mode the
 * `live-` prefix exists to prevent.
 *
 * ## What these tests are actually protecting
 *
 * Both endpoints exist to retire a specific lie. `pricingInsight()` used to fill a locality's
 * missing asking rate with its curated market rate, so a locality with nothing in it scored a
 * deviation of exactly zero and was counted as fairly priced — the report flattered precisely the
 * areas worth sourcing in. `slaMetrics()` invented approval turnaround wholesale.
 *
 * So the assertions below are not "the tab renders". They are: an unmeasured asking rate comes back
 * null and is **not** equal to the market rate beside it, the buy/rent counts partition the total
 * exactly, and the backlog is ordered longest-wait-first over a list anchored non-empty.
 *
 * ## How these tests know they are talking to the server
 *
 * `services/config.js` falls back to the mock provider with a `console.warn` — not an error — when
 * an http provider is missing. So a UI test asserting static column headers would stay green while
 * the tab read localStorage, which is the failure this file's `live-` prefix claims to rule out.
 * Each of the two UI tests therefore asserts a value only the database holds: a measured locality's
 * asking rate and buy count, and the title of the oldest listing in the real review queue. Neither
 * can be reproduced by a provider reading `db.json`.
 *
 * The `Sample` chips are deliberately **not** asserted here. They render from browser-generated
 * data in both modes, so they are a rendering contract, and `admin/analytics.spec.js` is where
 * rendering contracts belong — duplicating them live would cost a browser launch to learn nothing.
 *
 * ## Why the numbers are not asserted absolutely
 *
 * Other live specs create and approve listings, so the seeded counts move within a full run.
 * These assert structure, relationships and the null contract rather than fixed values — which is
 * the same reason `admin/live-reports.spec.js` gives for its property counts. `targetHours` is the
 * exception: it is a fixed policy constant the client colours against, so it is pinned at 24.
 */
import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

/** The seeded admin, as used by the other live admin specs. */
const admin = () => authHeaders('9000000000');

/** Sign in and deep-link to a tab. Deep-linking is the page's own contract, not a shortcut. */
async function openTab(page, login, tab) {
  await login.asAdmin();
  await page.goto(`/admin/analytics?tab=${tab}`);
  await expect(page.getByRole('heading', { name: /Analytics/i })).toBeVisible();
}

// ─── Pricing ───

test('pricing endpoint reports market and asking rates as separate fields', async ({ request }) => {
  const res = await request.get(`${API}/admin/analytics/pricing`, { headers: await admin() });
  expect(res.ok()).toBeTruthy();
  const rows = await res.json();
  expect(Array.isArray(rows)).toBeTruthy();
  expect(rows.length).toBeGreaterThan(0);

  for (const row of rows) {
    // Every key is present on every row even when null. An omitted key would leave the client with
    // `undefined`, which is one `?? marketRatePerSqft` away from re-introducing the fallback.
    expect(row).toHaveProperty('marketRatePerSqft');
    expect(row).toHaveProperty('avgActualRatePerSqft');
    expect(row).toHaveProperty('rentalYieldPct');
    // Exactly, not ≤. `deal` is `CHECK (deal IN ('buy','rent'))`, so the two filtered counts
    // partition the total. `≤` would pass with both filters broken and returning 0.
    expect(row.buyCount + row.rentCount).toBe(row.totalListings);
  }

  // The seed curates far more localities than it stocks, so unmeasured rows must exist. Anchored
  // here because the per-row loop above is satisfied by a response that measured everything; the
  // null contract itself is asserted in the test below, which is named for it.
  expect(rows.some((r) => r.avgActualRatePerSqft === null)).toBe(true);
});

test('a locality with a market rate but nothing priced reports null, not the market rate', async ({ request }) => {
  const res = await request.get(`${API}/admin/analytics/pricing`, { headers: await admin() });
  const rows = await res.json();

  // This is the retired bug, stated exactly. The interesting population is not "every unmeasured
  // locality" — most have no market rate either, so a fallback there would produce null anyway and
  // prove nothing. It is the locality that **has** a curated market rate sitting right beside an
  // empty measurement: the one place the old code had something to reach for, and did.
  const tempting = rows.filter((r) => r.marketRatePerSqft !== null && r.buyCount === 0);
  expect(tempting.length, 'seed must contain a locality with a market rate and no buy listings').toBeGreaterThan(0);
  for (const row of tempting) {
    expect(row.avgActualRatePerSqft, `${row.name} must not borrow its market rate`).toBeNull();
  }

  // Deliberately not asserted: `avgActual !== market` on the *measured* rows. The seed derives a
  // listing's price from its locality's market rate, so the two are legitimately identical wherever
  // both exist — an inequality check would fail on correct data.
});

test('Pricing tab renders the figures the server sent, not the mock provider\'s', async ({ page, login, request }) => {
  const res = await request.get(`${API}/admin/analytics/pricing`, { headers: await admin() });
  const rows = await res.json();
  const measured = rows.find((r) => r.avgActualRatePerSqft != null);
  expect(measured, 'seed must contain at least one locality with a measurable asking rate').toBeTruthy();

  await openTab(page, login, 'pricing');
  await expect(page.getByText('Locality Pricing Breakdown')).toBeVisible();

  // The assertion that makes this a *live* test. `services/config.js` falls back to the mock
  // provider with a console warning if the domain is missing from `VITE_API_DOMAINS`, so a spec
  // that checked only static headers would stay green while the tab read localStorage — which is
  // precisely what this test caught when it was written. A locality's measured asking rate and buy
  // count are database values the mock generator does not reproduce.
  const table = page.locator('table').filter({ has: page.getByText('Asking ₹/sqft') });
  const row = table.locator('tbody tr').filter({ hasText: measured.name }).first();
  await expect(row.locator('td').nth(2)).toHaveText(`₹${measured.avgActualRatePerSqft.toLocaleString('en-IN')}`);
  await expect(row.locator('td').nth(5)).toHaveText(String(measured.buyCount));
});

// ─── SLA ───

test('sla endpoint reports review turnaround and the live backlog', async ({ request }) => {
  const res = await request.get(`${API}/admin/analytics/sla`, { headers: await admin() });
  expect(res.ok()).toBeTruthy();
  const sla = await res.json();

  // Exactly 24, because the client colours "overdue" against this number and the seed's pending
  // rows are days old. `> 0` would be satisfied by 1, which is not a policy anyone set.
  expect(sla.targetHours).toBe(24);

  // Anchored non-empty. Without this, every assertion below is satisfied by `worstPending: []` and
  // `pendingCount: 0` — an endpoint that reported nothing at all would pass its own backlog test.
  expect(sla.pendingCount).toBeGreaterThan(0);
  expect(sla.worstPending.length).toBeGreaterThan(1);
  expect(sla.worstPending.length).toBeLessThanOrEqual(sla.pendingCount);
  expect(sla.pendingBreachingCount).toBeLessThanOrEqual(sla.pendingCount);

  // Longest wait first — the list is a work queue, so its order is part of the contract. Meaningful
  // only because the length is anchored above: a one-element list is sorted by definition.
  const waits = sla.worstPending.map((p) => p.hoursWaiting);
  expect([...waits].sort((a, b) => b - a)).toEqual(waits);
  expect(waits[0]).toBeGreaterThan(waits[waits.length - 1]);
});

test('sla endpoint rejects an impossible window rather than silently widening it', async ({ request }) => {
  const res = await request.get(`${API}/admin/analytics/sla?days=0`, { headers: await admin() });
  expect(res.status()).toBe(400);
});

test('both analytics endpoints are closed to a plain consumer', async ({ request }) => {
  // A freshly registered mobile holds no back-office role, so this is the guard as an ordinary
  // signed-in user meets it — 403, not 401. A 401 would mean the route was merely unauthenticated.
  // Both routes are checked: they carry separate copies of the same expression, so covering one
  // leaves the other free to drift.
  const headers = await authHeaders(uniqueMobile());
  for (const path of ['/admin/analytics/sla', '/admin/analytics/pricing']) {
    const res = await request.get(`${API}${path}`, { headers });
    expect(res.status(), `${path} must refuse a consumer`).toBe(403);
  }
});

test('SLA tab renders the backlog the server sent, not the mock provider\'s', async ({ page, login, request }) => {
  const res = await request.get(`${API}/admin/analytics/sla`, { headers: await admin() });
  const { targetHours, worstPending } = await res.json();

  await openTab(page, login, 'sla');
  // The target is a drift canary rather than a discriminator — both sides say 24 today, and this
  // fails the day only one of them changes.
  await expect(page.getByText(`Within ${targetHours}h target`)).toBeVisible();
  await expect(page.getByText('Longest Waiting Listings')).toBeVisible();

  // This is the discriminator. The queue is seeded live data; the mock provider builds its own
  // backlog from localStorage listings, so the server's oldest pending title appearing on screen
  // could not survive a silent fallback to it.
  await expect(page.getByRole('link', { name: worstPending[0].title })).toBeVisible();
});
