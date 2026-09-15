/* The Pricing, SLA and page-view analytics **endpoint contracts**; `live-analytics-page.spec.js`
   owns the page itself. Structure, relationships and the null contract are asserted rather than
   fixed numbers, because other specs move the seeded counts within a run. */
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
  // here because the per-row loop above is satisfied by a response that measured everything.
  expect(rows.some((r) => r.avgActualRatePerSqft === null)).toBe(true);
});

test('a locality with a market rate but nothing priced reports null, not the market rate', async ({ request }) => {
  const res = await request.get(`${API}/admin/analytics/pricing`, { headers: await admin() });
  const rows = await res.json();

  // The interesting population is the locality that **has** a curated market rate sitting beside an
  // empty measurement — the one place a fallback had something to reach for.
  const tempting = rows.filter((r) => r.marketRatePerSqft !== null && r.buyCount === 0);
  expect(tempting.length, 'seed must contain a locality with a market rate and no buy listings').toBeGreaterThan(0);
  for (const row of tempting) {
    expect(row.avgActualRatePerSqft, `${row.name} must not borrow its market rate`).toBeNull();
  }

  // Deliberately not asserted: `avgActual !== market` on the *measured* rows. The seed derives a
  // listing's price from its locality's market rate, so an inequality check would fail on good data.
});

test('Pricing tab renders the figures the server sent, not the mock provider\'s', async ({ page, login, request }) => {
  const res = await request.get(`${API}/admin/analytics/pricing`, { headers: await admin() });
  const rows = await res.json();
  const measured = rows.find((r) => r.avgActualRatePerSqft != null);
  expect(measured, 'seed must contain at least one locality with a measurable asking rate').toBeTruthy();

  await openTab(page, login, 'pricing');
  await expect(page.getByText('Locality Pricing Breakdown')).toBeVisible();

  // The assertion that makes this a *live* test: a locality's measured asking rate and buy count are
  // database values a provider reading `db.json` does not reproduce.
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

test('the three service tracks are measured, and say so by leaving unmeasurable fields null', async ({ request }) => {
  /* The null contract, not the numbers: the seed's audit history is whatever the run before it left,
     so a track that coalesced its average to 0 over zero completions would report a zero-hour
     turnaround — the most flattering possible reading of having measured nothing. */
  const res = await request.get(`${API}/admin/analytics/sla`, { headers: await admin() });
  expect(res.ok()).toBeTruthy();
  const sla = await res.json();

  const tracks = {
    // Targets are policy constants the client colours against, so they are pinned rather than
    // merely present — the same reasoning as `targetHours` above.
    ticketPickup: 4,
    ticketDelivery: 72,
    conciergeToLive: 168,
  };

  for (const [key, targetHours] of Object.entries(tracks)) {
    const t = sla[key];
    expect(t, `${key} must be served`).toBeTruthy();
    expect(t.targetHours, `${key} target`).toBe(targetHours);

    // Counts are counts: present, non-negative, never null. Only the averages are allowed to be
    // absent, and only because the set they average over can be empty.
    for (const count of ['completedCount', 'breachedCount', 'outstandingCount', 'outstandingBreachingCount']) {
      expect(typeof t[count], `${key}.${count}`).toBe('number');
      expect(t[count], `${key}.${count}`).toBeGreaterThanOrEqual(0);
    }

    // A breach is a completion that ran long and an outstanding item past target is still
    // outstanding — either count exceeding its parent means they were counted over different sets.
    expect(t.breachedCount, `${key} breaches ⊆ completions`).toBeLessThanOrEqual(t.completedCount);
    expect(t.outstandingBreachingCount, `${key} late ⊆ outstanding`).toBeLessThanOrEqual(t.outstandingCount);

    if (t.completedCount === 0) {
      // Nothing completed. Anything but null here is a number nobody measured.
      expect(t.avgHours, `${key} avg with no completions`).toBeNull();
      expect(t.medianHours, `${key} median with no completions`).toBeNull();
      expect(t.slaRatePct, `${key} rate with no completions`).toBeNull();
    } else {
      expect(t.avgHours, `${key} avg`).toBeGreaterThanOrEqual(0);
      expect(t.medianHours, `${key} median`).toBeGreaterThanOrEqual(0);
      expect(t.slaRatePct, `${key} rate`).toBeGreaterThanOrEqual(0);
      expect(t.slaRatePct, `${key} rate`).toBeLessThanOrEqual(100);
      // The rate is the completions inside target, expressed as a percentage of all of them — not
      // a separate figure that could drift away from the two counts it is derived from.
      const derived = Math.round(((t.completedCount - t.breachedCount) / t.completedCount) * 100);
      expect(t.slaRatePct, `${key} rate agrees with its counts`).toBe(derived);
    }
  }
});

test('both analytics endpoints are closed to a plain consumer', async ({ request }) => {
  // A freshly registered mobile holds no back-office role, so this is 403, not 401. Both routes are
  // checked: they carry separate copies of the same expression and one can drift.
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

  // The discriminator: the queue is seeded live data, so the server's oldest pending title appearing
  // on screen could not survive a silent fallback to a browser-side store.
  await expect(page.getByRole('link', { name: worstPending[0].title })).toBeVisible();
});

// ─── Page views: Traffic, Engagement, Anonymous surfers ───

/* Nothing below depends on `page_view_daily` holding traffic — a scheduled rollup fills it on a tick
   no spec controls. The contracts asserted are true of an empty window and a busy one alike, and the
   zero-fill matters most: a series that omitted quiet days draws a line across the gap. */

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

  // The closed channel vocabulary in full — the service seeds all five at zero. Asserting the whole
  // set is what stops a raw referring host ever reaching the doughnut.
  const CHANNELS = ['Organic search', 'Direct', 'WhatsApp', 'Social', 'Other referrals'];
  expect(report.sources.map((s) => s.channel).sort()).toEqual([...CHANNELS].sort());

  // Gated on sessions, not on `sources.length`, which is always five: an empty-state guarded by row
  // count never fires, so a window nobody visited draws five zero-slices instead of saying so.
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

  // Stated as an equivalence so it cannot be satisfied by an endpoint returning null in both cases.
  // A rate over no sessions is not 0% — 0% means everybody who came stayed anonymous.
  expect(report.anonSharePct === null).toBe(report.totalSessions === 0);
  expect(report.conversionRatePct === null).toBe(report.totalSessions === 0);

  for (const page of report.pages) {
    // Anonymous views are a subset of all views on the same path, from the same rollup row.
    expect(page.anonViews).toBeLessThanOrEqual(page.views);
  }

  // Share of the exits *shown* — the list is capped at ten paths, so this sums to 100 across what is
  // displayed. A ≤ 101 bound would also pass if it were share-of-all.
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
    // A week is identified by the Monday it starts on. Asserting the weekday, not merely the format:
    // an off-by-one in the truncation still produces a valid date and shifts every bucket by a day.
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
  // A freshly registered mobile holds no back-office role, so this is 403 and not 401. All three
  // routes are checked because they carry separate copies of the same expression.
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

  /* Not a fallback discriminator — both an empty mock window and the e2e one render dashes. What it
     proves is that a null rate reaches the screen as an em dash rather than being coerced to `0%`. */
  const inr = (n) => n.toLocaleString('en-IN');
  await expect(page.getByText(`Out of ${inr(report.totalSessions)} total sessions`)).toBeVisible();
  await expect(page.getByText('Anonymous sessions')).toBeVisible();

  const expectedShare = report.anonSharePct === null ? '\u2014' : `${report.anonSharePct}%`;
  await expect(page.getByText('Anonymous share').locator('..')).toContainText(expectedShare);
});
