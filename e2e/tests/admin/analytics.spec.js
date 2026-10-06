// The Pricing, SLA and page-view analytics **endpoint contracts**; `analytics-page.spec.js` owns the page itself.
import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';
import { fmtINR } from '../../../frontend/src/lib/format.js';

// The seeded admin, as used by the other live admin specs.
const admin = () => authHeaders('9000000000');

// Deep-linking is the page's own contract, not a shortcut.
async function openTab(page, login, tab) {
  await login.asAdmin();
  await page.goto(`/admin/analytics?tab=${tab}`);
  await expect(page.getByRole('heading', { name: /Analytics/i })).toBeVisible();
}

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
  await expect(row.locator('td').nth(2)).toHaveText(fmtINR(measured.avgActualRatePerSqft));
  await expect(row.locator('td').nth(5)).toHaveText(String(measured.buyCount));
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

// Nothing below depends on `page_view_daily` holding traffic — a scheduled rollup fills it on a tick no spec controls.
const PAGE_VIEW_REPORTS = ['/admin/analytics/traffic', '/admin/analytics/engagement', '/admin/analytics/surfers'];

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

test('page-view report routes validate the window and refuse a plain consumer', async ({ request }) => {
  await test.step('page-view reports validate the window rather than silently widening it', async () => {
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
  await test.step('page-view reports are closed to a plain consumer', async () => {
    // A freshly registered mobile holds no back-office role, so this is 403 and not 401. All three
    // routes are checked because they carry separate copies of the same expression.
    const headers = await authHeaders(uniqueMobile());
    for (const path of PAGE_VIEW_REPORTS) {
      const res = await request.get(`${API}${path}`, { headers });
      expect(res.status(), `${path} must refuse a consumer`).toBe(403);
    }
  });
  await test.step('the traffic report echoes its window, has one contiguous point per day and never counts fewer views than sessions', async () => {
    const days = 14;
    const res = await request.get(`${API}/admin/analytics/traffic?days=${days}`, { headers: await admin() });
    expect(res.ok()).toBeTruthy();
    const report = await res.json();

    expect(report.days).toBe(days);
    expect(report.series).toHaveLength(days);
    for (let i = 1; i < report.series.length; i += 1) {
      const gap = Date.parse(`${report.series[i].date}T00:00:00Z`) - Date.parse(`${report.series[i - 1].date}T00:00:00Z`);
      expect(gap, `${report.series[i - 1].date} to ${report.series[i].date} must be one day apart`).toBe(86400000);
    }
    expect(report.series[0].date).toBe(report.from);
    for (const day of report.series) {
      expect(typeof day.sessions).toBe('number');
      expect(typeof day.pageviews).toBe('number');
      expect(typeof day.signups).toBe('number');
      expect(day.pageviews).toBeGreaterThanOrEqual(day.sessions);
    }
  });
});

test('Traffic tab renders the anonymous-audience null contract as a dash, not as 0%', async ({ page, login, request }) => {
  const res = await request.get(`${API}/admin/analytics/surfers?days=30`, { headers: await admin() });
  const report = await res.json();

  await openTab(page, login, 'traffic');
  // Same window as the API read above; the page default is wider.
  await page.getByLabel('Report window').click();
  await page.getByRole('option', { name: 'Last 30 days' }).click();
  // Not a fallback discriminator — both an empty mock window and the e2e one render dashes.
  const inr = (n) => n.toLocaleString('en-IN');
  await expect(page.getByText(`Out of ${inr(report.totalSessions)} total sessions`)).toBeVisible();
  await expect(page.getByText('Anonymous sessions', { exact: true })).toBeVisible();

  const expectedShare = report.anonSharePct === null ? '\u2014' : `${report.anonSharePct}%`;
  await expect(page.getByText('Anonymous share', { exact: true }).locator('..')).toContainText(expectedShare);
});
