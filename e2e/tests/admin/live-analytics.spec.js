/**
 * The Pricing, SLA and page-view analytics **endpoint contracts**, against the live API.
 *
 * ## What this file owns, and what its sibling owns
 *
 * `admin/live-analytics-page.spec.js` owns the page: the tab strip, URL sync, deep links, the CSV
 * export, the no-remount rule, per-tab rendering and the illustrative-data labelling. This file
 * owns what the server promises, and the two UI tests here are the ones that exist to prove the
 * page is talking to it at all.
 *
 * Both files used to be one, `admin/analytics.spec.js`, on the mock config. It was converted once
 * Geography turned out to have been live since register 36 and Seasonal turned out to be
 * illustrative by decision rather than by backlog — so the "until they follow" this file's header
 * used to rely on described an event that was never coming.
 *
 * ## What these tests are actually protecting
 *
 * Both older endpoints exist to retire a specific lie. `pricingInsight()` used to fill a locality's
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
 * the tab read localStorage, which is the failure the `live-` prefix claims to rule out.
 * Each of the two UI tests therefore asserts a value only the database holds: a measured locality's
 * asking rate and buy count, and the title of the oldest listing in the real review queue. Neither
 * can be reproduced by a provider reading `db.json`. That is why those two stayed here when the
 * rest of the rendering moved — they are discriminators, not renders.
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

// ─── Page views: Traffic, Engagement, Anonymous surfers ───

/**
 * These three read `page_view_daily` and `page_view_daily_referrers`, which are rebuilt by a
 * scheduled rollup a minute after startup and hourly after that. A test cannot post page views and
 * then assert they appear — it would have to wait for a tick it does not control — so nothing below
 * depends on the table holding traffic.
 *
 * That is not a weaker test, it is a different one. The contracts these endpoints have to keep are
 * true of an empty window and a busy one alike: the day series is zero-filled to exactly the
 * requested length rather than skipping quiet days, sessions partition into anonymous and
 * signed-in, a rate is null when nothing was measured while a count is zero, and the window is
 * validated rather than clamped. Every one of those is a decision that was made explicitly, and
 * every one of them is invisible to a chart that happens to be drawn.
 *
 * The zero-fill in particular is the whole point. A series that omitted quiet days would draw a
 * line joining the two busy ones on either side, which reads as sustained traffic across a gap.
 */

const PAGE_VIEW_REPORTS = ['/admin/analytics/traffic', '/admin/analytics/engagement', '/admin/analytics/surfers'];

test('page-view reports zero-fill the requested window rather than skipping quiet days', async ({ request }) => {
  const days = 14;
  const res = await request.get(`${API}/admin/analytics/traffic?days=${days}`, { headers: await admin() });
  expect(res.ok()).toBeTruthy();
  const report = await res.json();

  expect(report.days).toBe(days);
  // Exactly `days` points, contiguous, oldest first. A gap here is not a missing dot — Chart.js
  // joins the neighbours, so a quiet Tuesday would be drawn as traffic that never happened.
  expect(report.series).toHaveLength(days);
  for (let i = 1; i < report.series.length; i += 1) {
    const gap = Date.parse(`${report.series[i].date}T00:00:00Z`) - Date.parse(`${report.series[i - 1].date}T00:00:00Z`);
    expect(gap, `${report.series[i - 1].date} → ${report.series[i].date} must be one day apart`).toBe(86400000);
  }
  expect(report.series[0].date).toBe(report.from);

  // Counts, not rates: these are primitives and are 0 on a quiet day, never null. The distinction
  // is the one the DTO makes deliberately, and a client rendering `null` as 0 would hide it.
  for (const day of report.series) {
    expect(typeof day.sessions).toBe('number');
    expect(typeof day.pageviews).toBe('number');
    expect(typeof day.signups).toBe('number');
    // Every session is at least one page view, by construction — a session exists because a view
    // created it. Fewer views than sessions would mean the two queries disagree about the window.
    expect(day.pageviews).toBeGreaterThanOrEqual(day.sessions);
  }

  // The closed channel vocabulary, in full, every time. This is not "the channels that had
  // traffic" — the service seeds all five at zero — and asserting the whole set is what stops a
  // raw referring host ever reaching the doughnut, which is the shape the rollup exists to avoid.
  const CHANNELS = ['Organic search', 'Direct', 'WhatsApp', 'Social', 'Other referrals'];
  expect(report.sources.map((s) => s.channel).sort()).toEqual([...CHANNELS].sort());

  // Gated on sessions and not on `sources.length`, which is always five. That distinction is the
  // defect this test found in the tab beside it: an empty-state guarded by row count never fired,
  // so a window nobody visited drew five zero-slices instead of saying nobody visited.
  const sessionTotal = report.sources.reduce((sum, s) => sum + s.sessions, 0);
  if (sessionTotal > 0) {
    const share = report.sources.reduce((sum, s) => sum + s.sharePct, 0);
    // Rounded per slice, so the total lands near 100 rather than on it.
    expect(share).toBeGreaterThan(98);
    expect(share).toBeLessThan(102);
  } else {
    expect(report.sources.every((s) => s.sharePct === 0)).toBe(true);
  }
});

test('surfers report partitions every session into anonymous or signed-in', async ({ request }) => {
  const res = await request.get(`${API}/admin/analytics/surfers?days=30`, { headers: await admin() });
  expect(res.ok()).toBeTruthy();
  const report = await res.json();

  // Exactly, not ≤. A session either carried a user id on one of its views or it did not, so the
  // two counts partition the total. `≤` would pass with both branches broken and returning 0.
  expect(report.anonSessions + report.signedInSessions).toBe(report.totalSessions);

  // The null-vs-zero contract, stated as an equivalence rather than as two separate checks so it
  // cannot be satisfied by an endpoint that returns null in both cases. A rate over no sessions is
  // not 0% — 0% means everybody who came stayed anonymous, which is a different fact entirely.
  expect(report.anonSharePct === null).toBe(report.totalSessions === 0);
  expect(report.conversionRatePct === null).toBe(report.totalSessions === 0);

  for (const page of report.pages) {
    // Anonymous views are a subset of all views on the same path, from the same rollup row.
    expect(page.anonViews).toBeLessThanOrEqual(page.views);
  }

  // Share of the exits shown, not of all exits — the list is capped at ten paths, so this sums to
  // 100 across what is displayed. Asserting ≤ 101 would also pass if it were share-of-all, which
  // is the reading the tab's own comment rules out.
  if (report.dropOff.length) {
    const share = report.dropOff.reduce((sum, d) => sum + d.sharePct, 0);
    expect(share).toBeGreaterThan(98);
    expect(share).toBeLessThan(102);
  }
});

test('engagement report reports an unmeasured week as null rather than as a perfect score', async ({ request }) => {
  const res = await request.get(`${API}/admin/analytics/engagement?days=60`, { headers: await admin() });
  expect(res.ok()).toBeTruthy();
  const report = await res.json();

  // Zero-filled to whole ISO weeks, so a window with no traffic still returns buckets. Without
  // this the chart's x-axis would shrink to the busy weeks and relabel itself run to run.
  expect(report.weeks.length).toBeGreaterThan(0);
  for (const week of report.weeks) {
    // A week is identified by the Monday it starts on, not by an ISO week label. Asserting the
    // weekday and not merely the format is the point: an off-by-one in the truncation would still
    // produce a valid date, and would silently shift every bucket by a day.
    expect(week.week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${week.week}T00:00:00Z`).getUTCDay(), `${week.week} must be a Monday`).toBe(1);
    expect(typeof week.sessions).toBe('number');
    // A week nobody visited has no average duration and no bounce rate. Zero would read as
    // "everyone left instantly", which is the opposite of "nobody came".
    if (week.sessions === 0) {
      expect(week.avgSessionMinutes, `${week.week} had no sessions`).toBeNull();
      expect(week.bounceRatePct, `${week.week} had no sessions`).toBeNull();
    }
    if (week.bounceRatePct !== null) {
      expect(week.bounceRatePct).toBeGreaterThanOrEqual(0);
      expect(week.bounceRatePct).toBeLessThanOrEqual(100);
    }
  }

  for (const page of report.topPages) {
    expect(page.anonViews).toBeLessThanOrEqual(page.views);
  }
  // Ordered by views, descending — it is a "top pages" chart, so the order is the content.
  const views = report.topPages.map((p) => p.views);
  expect([...views].sort((a, b) => b - a)).toEqual(views);
});

test('page-view reports validate the window rather than silently widening it', async ({ request }) => {
  const headers = await admin();
  // Both ends. Only checking 0 would leave the upper bound free to be dropped, and a request for
  // 100000 days is a full table scan the cap exists to refuse.
  for (const path of PAGE_VIEW_REPORTS) {
    for (const days of [0, 401]) {
      const res = await request.get(`${API}${path}?days=${days}`, { headers });
      expect(res.status(), `${path}?days=${days} must be refused`).toBe(400);
    }
  }
});

test('page-view reports are closed to a plain consumer', async ({ request }) => {
  // Same reasoning as the pricing/SLA guard above: a freshly registered mobile holds no back-office
  // role, so this is 403 and not 401. All three routes are checked because they carry separate
  // copies of the same expression and covering one leaves the others free to drift.
  const headers = await authHeaders(uniqueMobile());
  for (const path of PAGE_VIEW_REPORTS) {
    const res = await request.get(`${API}${path}`, { headers });
    expect(res.status(), `${path} must refuse a consumer`).toBe(403);
  }
});

test('Anonymous surfers tab renders the null contract as a dash, not as 0%', async ({ page, login, request }) => {
  const res = await request.get(`${API}/admin/analytics/surfers?days=30`, { headers: await admin() });
  const report = await res.json();

  await openTab(page, login, 'surfers');

  /*
   * Note what this test is NOT, because the two tests above it are.
   *
   * The Pricing and SLA UI tests are true fallback discriminators: they assert a database value the
   * mock provider cannot reproduce, so they fail if `services/config.js` silently resolves the
   * `analytics` domain to the mock. This one cannot do that, and pretending otherwise would be
   * worse than not trying. The mock page-view provider returns an empty window on purpose — there
   * is no browser-side view store to draw from — and the live e2e database is also empty, because
   * the rollup that fills it ticks on a schedule no spec controls. Both sides therefore render
   * zeroes and dashes, and every assertion below passes under either.
   *
   * It becomes a discriminator the moment the e2e window holds a rolled-up session, and not before.
   *
   * What it does prove today is the part that has already been got wrong once: that a null rate
   * survives the whole way to the screen as an em dash instead of being coerced to `0%` by some
   * `?? 0` in the provider or the tab. That is a real contract, it is asserted against the server's
   * own response rather than a literal, and it is exactly the class of defect this endpoint exists
   * to retire — a report that answers confidently when it measured nothing.
   */
  const inr = (n) => n.toLocaleString('en-IN');
  await expect(page.getByText(`Out of ${inr(report.totalSessions)} total sessions`)).toBeVisible();
  await expect(page.getByText('Anonymous sessions')).toBeVisible();

  const expectedShare = report.anonSharePct === null ? '\u2014' : `${report.anonSharePct}%`;
  await expect(page.getByText('Anonymous share').locator('..')).toContainText(expectedShare);
});
