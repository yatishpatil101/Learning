/**
 * `/admin/analytics` — the page itself, against the live API.
 *
 * ## What this file is, and why it is not `admin/analytics.spec.js` any more
 *
 * The mock version of this file guarded the page's own behaviour: the tab strip, URL sync, deep
 * links, the CSV export, the no-remount rule, and the illustrative-data labelling. It stayed on the
 * mock config behind a header saying Geography and Seasonal "still compute in the browser" and the
 * file would follow "when they follow".
 *
 * Neither half held. Geography has read `listLocalities()` — `GET /localities`, with measured
 * `listingCount`, `demand` and `ratePerSqft` — since register 36. And Seasonal is illustrative **by
 * decision**, not by backlog: seasonality needs several years of history the platform has not
 * lived through, so it renders a seeded PRNG behind a `SampleTabNotice` and is expected to keep
 * doing so. There was never going to be an event to wait for.
 *
 * ## Why the rendering assertions belong here rather than on the mock config
 *
 * `admin/live-analytics.spec.js` — which stays, and owns the **endpoint contracts** — argues that
 * the `Sample` chips "render from browser-generated data in both modes, so they are a rendering
 * contract" and duplicating them live "would cost a browser launch to learn nothing". That is right
 * about the data source and wrong about the risk.
 *
 * The labelling guard exists to catch a tab that **has since become real** still wearing its
 * banner, and the converse — a tab quietly reverting to generated numbers with the banner gone.
 * Both of those transitions happen on the live build, because that is where a tab becomes real.
 * Traffic and Anonymous surfers already made that journey once. Asserting the rule only against
 * localStorage checks it in the one place it cannot be violated.
 *
 * The same argument covers the per-tab render tests, more plainly: under the mock every tab draws
 * from `db.json`, so "Engagement tab renders its charts" says nothing about whether `EngagementTab`
 * survives the shape the API actually returns. Here it does.
 *
 * ## What is deliberately NOT re-asserted here
 *
 * The endpoint contracts, and the two tabs whose *figures* `live-analytics.spec.js` already pins to
 * server values (`Pricing tab renders the figures the server sent`, `SLA tab renders the backlog
 * the server sent`). Those are the discriminators that prove the page is not silently on the mock
 * — `services/config.js` falls back with a `console.warn`, not an error — and they are asserted
 * once, there. The `Anonymous surfers` KPI-tile sweep went the same way: that file's
 * "renders the null contract as a dash, not as 0%" is the stronger version of it.
 */
import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** The seeded admin, as used by the other live admin specs. */
const admin = () => authHeaders('9000000000');

/** Every tab in the strip, in render order. Named once so the "all eight" test cannot drift. */
const TABS = ['Traffic', 'Engagement', 'Anonymous surfers', 'Geography', 'Supply Gap', 'Pricing', 'SLA', 'Seasonal'];

/** Sign in and land on the tab under test. Deep-linking is the page's own contract, so using it
 *  here is not a shortcut around the UI — it is the same path a bookmarked report takes. */
async function openAnalytics(page, login, tab) {
  await login.asAdmin();
  await page.goto(tab ? `/admin/analytics?tab=${tab}` : '/admin/analytics');
  await expect(page.getByRole('heading', { name: /Analytics/i })).toBeVisible();
}

// ─── Page load and tab strip ───

test('analytics page loads without errors', async ({ page, login, consoleErrors }) => {
  await openAnalytics(page, login);
  // The heading above is the anchor: an empty error list means nothing if the page never rendered.
  await expect(page.getByRole('tab', { name: 'Traffic' })).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

test('analytics opens on Traffic and offers all eight tabs', async ({ page, login }) => {
  await openAnalytics(page, login);
  await expect(page.getByRole('tab', { name: 'Traffic' })).toHaveAttribute('aria-selected', 'true');
  for (const label of TABS) {
    await expect(page.getByRole('tab', { name: label })).toBeVisible();
  }
});

test('analytics does not show a Conversion tab', async ({ page, login }) => {
  await openAnalytics(page, login);
  // Conversion moved to the Enquiries funnel (`admin/consolidation.spec.js` asserts it arrived).
  // Anchored on the strip having rendered, so this is "not among these eight" rather than
  // "nothing matched", which a blank page would also satisfy.
  await expect(page.getByRole('tab', { name: 'Traffic' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Conversion' })).toHaveCount(0);
});

// ─── Traffic tab ───

test('Traffic tab: chart cards and range selector', async ({ page, login }) => {
  await openAnalytics(page, login);
  await expect(page.getByText('Sessions & page views')).toBeVisible();
  await expect(page.getByText('Traffic sources')).toBeVisible();
  await expect(page.getByText('Device split')).toBeVisible();
  // Was "New vs returning". `session_id` is per-tab, so a return visit is structurally
  // underivable from what is collected — the card asks a question the data can answer instead.
  await expect(page.getByText('Anonymous vs signed-in')).toBeVisible();
  await expect(page.getByLabel('Traffic window')).toBeVisible();
});

test('Traffic tab: export produces a CSV', async ({ page, login }) => {
  await openAnalytics(page, login);
  // Armed before the click. The original clicked and asserted nothing, so an export that quietly
  // produced no file — the only failure worth catching here — passed.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export traffic CSV/i }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/i);
});

// ─── Tab switching and URL sync ───

test('clicking a tab updates the URL search param', async ({ page, login }) => {
  await openAnalytics(page, login);
  await page.getByRole('tab', { name: 'Engagement' }).click();
  await expect(page).toHaveURL(/tab=engagement/);
});

test('deep-linking to ?tab=geography opens Geography', async ({ page, login }) => {
  await openAnalytics(page, login, 'geography');
  await expect(page.getByRole('tab', { name: 'Geography' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Listings by locality')).toBeVisible();
});

test('switching tabs does not remount: the days selector keeps its value', async ({ page, login }) => {
  await openAnalytics(page, login);
  await page.getByLabel('Traffic window').click();
  await page.getByRole('option', { name: 'Last 30 days' }).click();
  await expect(page.getByLabel('Traffic window')).toContainText('30 days');

  await page.getByRole('tab', { name: 'Engagement' }).click();
  await page.getByRole('tab', { name: 'Traffic' }).click();
  // Still 30 days: the tab panel is swapped, not the page. Asserting the value *before* the round
  // trip as well means a selector that never took the change cannot pass by never changing.
  //
  // Live this is a stronger claim than it was on the mock: changing the window refetches
  // `GET /admin/analytics/traffic?days=30`, so a remount would be visible as a second request for
  // the default window rather than merely as a reset control.
  await expect(page.getByLabel('Traffic window')).toContainText('30 days');
});

// ─── The remaining tabs render against real payloads ───

test('Engagement tab renders its charts', async ({ page, login }) => {
  await openAnalytics(page, login, 'engagement');
  await expect(page.getByText('Avg. session duration')).toBeVisible();
  await expect(page.getByText('Bounce rate')).toBeVisible();
  await expect(page.getByText('Top pages by views')).toBeVisible();
});

test('Geography tab renders locality charts', async ({ page, login }) => {
  await openAnalytics(page, login, 'geography');
  await expect(page.getByText('Listings by locality')).toBeVisible();
  await expect(page.getByText('Demand index by locality')).toBeVisible();
  await expect(page.getByText(/Avg. rate/)).toBeVisible();
});

test('Supply Gap tab renders KPI cards, the table and city expansion requests', async ({ page, login }) => {
  await openAnalytics(page, login, 'supply-gap');
  await expect(page.getByText('Under-served', { exact: true })).toBeVisible();
  await expect(page.getByText('Well-served', { exact: true })).toBeVisible();
  await expect(page.getByText('Supply vs Demand by Locality')).toBeVisible();
  await expect(page.getByText('All Localities')).toBeVisible();
  await expect(page.getByText('City Expansion Requests')).toBeVisible();
});

test('Pricing tab renders KPI tiles and tables', async ({ page, login }) => {
  await openAnalytics(page, login, 'pricing');
  await expect(page.getByText('Listings analysed')).toBeVisible();
  await expect(page.getByText('Listing Price Position')).toBeVisible();
  await expect(page.getByText('Locality Pricing Breakdown')).toBeVisible();
});

test('SLA tab renders the review KPI row and targets', async ({ page, login }) => {
  await openAnalytics(page, login, 'sla');
  await expect(page.getByText('Listings reviewed')).toBeVisible();
  await expect(page.getByText('Avg time to review')).toBeVisible();
  await expect(page.getByText('Longest Waiting Listings')).toBeVisible();
  await expect(page.getByText('SLA Targets')).toBeVisible();
});

test('Seasonal tab renders the demand pattern and events', async ({ page, login }) => {
  await openAnalytics(page, login, 'seasonal');
  await expect(page.getByText('Monthly demand pattern')).toBeVisible();
  await expect(page.getByText('Key seasonal events')).toBeVisible();
  await expect(page.getByText('Year-over-year demand growth')).toBeVisible();
});

// ─── Unmeasured values are reported as unmeasured ───

test('SLA tab reports an unmeasured turnaround as unrecorded, not as zero', async ({ page, login, request }) => {
  /* The rule, which is the server's now: a turnaround nobody recorded renders as "not recorded" and
     never as `0h`, which would claim instantaneous review. The expectation is taken from the
     endpoint rather than hardcoded, so this asserts *the screen agrees with the server* instead of
     asserting a fact about the seed — and it fails loudly, naming the value, on the day the seed
     gains an audit trail, rather than quietly changing subject. */
  const res = await request.get(`${API}/admin/analytics/sla`, { headers: await admin() });
  expect(res.ok()).toBeTruthy();
  const { avgHoursToReview } = await res.json();

  await openAnalytics(page, login, 'sla');
  expect(
    avgHoursToReview,
    'the e2e seed records no review decisions, so this is expected to be null; if it is a number '
      + 'the assertion below is the wrong one and the test needs rewriting, not relaxing',
  ).toBeNull();

  /* Scoped to the one tile, and the scoping is load-bearing rather than tidiness. `0h` **is** on
     this tab legitimately: the Service Fulfillment and Concierge Pipeline panels are generated by
     `lib/data/analytics-extra.js`, and against a live build's sparser store their averages round to
     zero. Those cards carry a `Sample` chip and are asserted separately below. A page-wide
     `toHaveCount(0)` on `0h` therefore fails for a reason that has nothing to do with the rule —
     which is how it failed when this test was first written live, and is worth recording because
     the mock config could never have shown it. */
  const reviewTile = page.locator('div.rounded-xl').filter({ hasText: 'Avg time to review' });
  await expect(reviewTile).toHaveCount(1);
  await expect(reviewTile).toContainText('not recorded');
  // The specific wrong answer this guards against. A `|| 0` creeping back into `hours()` — whose
  // own comment promises "Never `0h`" — reads as a real measurement of a review that was never timed.
  await expect(reviewTile).not.toContainText('0h');
});

test('Pricing tab shows a dash, not the market rate, where nothing was measured', async ({ page, login }) => {
  await openAnalytics(page, login, 'pricing');
  const table = page.locator('table').filter({ has: page.getByText('Asking ₹/sqft') });
  await expect(table).toBeVisible();

  // The regression this endpoint exists to fix: a locality with no approved buy listings used to
  // borrow the curated market rate and so scored as perfectly priced. Asserting the *headers* would
  // not catch its return — restoring `avgActualRatePerSqft ?? marketRatePerSqft` leaves both columns
  // in place. So this finds a row that is actually unmeasured and reads the two cells.
  //
  // The seed curates ~100 localities and stocks a handful, so such a row is guaranteed; the
  // reconciliation sentence below is asserted first, which fails loudly if that ever stops holding
  // rather than letting the row search time out with no explanation.
  await expect(
    page.getByText(/\d+ of \d+ localities have no approved listing with a usable area/),
  ).toBeVisible();

  const dashRow = table.locator('tbody tr').filter({ hasText: '—' }).first();
  await expect(dashRow).toBeVisible();
  // Asking is the dash; market is a rupee figure on the same row. Both halves matter: the first
  // proves nothing was invented, the second proves the dash is not simply an empty table.
  await expect(dashRow.locator('td').nth(2)).toHaveText('—');
  await expect(dashRow.locator('td').nth(1)).toContainText('₹');
});

// ─── Illustrative-data labelling ───

/* Seasonal has no measured source at all: PuneNest holds nothing like the multi-year history a
 * year-over-year demand chart needs. It carries a banner saying so, and without this assertion the
 * banner is one careless edit away from disappearing, taking the tab back to presenting generated
 * numbers as reporting.
 *
 * Traffic and Anonymous surfers were on this list. They came off it because they stopped being
 * illustrative — both read the page-view aggregates now — and the banner went with the generator.
 * The pairing is the point: a tab either draws measured data or says it does not, and the same
 * change has to move both. Any tab reintroduced on generated numbers belongs back in this loop.
 *
 * Asserted here rather than on the mock config because the transition it guards — a tab becoming
 * real — only happens on the live build.
 */
for (const [tab, heading] of [['seasonal', 'Seasonal']]) {
  test(`${heading} tab is marked as illustrative`, async ({ page, login }) => {
    await openAnalytics(page, login, tab);
    await expect(page.getByText('Illustrative data.')).toBeVisible();
  });
}

/* The converse: the two tabs that came off the list must no longer claim to be samples. A banner
 * left behind on measured data is the same defect pointing the other way. */
for (const [tab, heading] of [['traffic', 'Traffic'], ['surfers', 'Anonymous surfers']]) {
  test(`${heading} tab is not marked as illustrative`, async ({ page, login }) => {
    await openAnalytics(page, login, tab);
    // Anchored on the tab having rendered — a blank page satisfies a bare toHaveCount(0) for free.
    await expect(page.getByRole('tab', { name: heading })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Illustrative data.')).toHaveCount(0);
  });
}

/* The `Sample` chips on Pricing and SLA. These label the individual cards that are generated on a
 * tab whose other cards are measured, which is the harder case to keep honest: a whole-tab banner
 * is obvious when it goes, a per-card chip is not. Both tabs mix the two, and the mixture is the
 * reason the chip has to be asserted rather than the card's presence — asserting visibility would
 * keep passing if someone deleted the label. */
test('Pricing tab labels the cards it cannot measure', async ({ page, login }) => {
  await openAnalytics(page, login, 'pricing');
  // The six-month trend and the per-listing table are generated — PuneNest keeps no price history
  // and the endpoint reports per locality. Both must say so, or the tab reads as all-measured.
  const trend = page.locator('.pn-card').filter({ hasText: 'Price trend' });
  await expect(trend.getByText('Sample', { exact: true })).toBeVisible();
  const positions = page.locator('div').filter({ hasText: /^Listing Price Position/ }).first();
  await expect(positions.getByText('Sample', { exact: true }).first()).toBeVisible();
});

test('SLA tab labels the panels it cannot measure', async ({ page, login }) => {
  await openAnalytics(page, login, 'sla');
  // Service tickets and the concierge pipeline are a different domain with no audit trail, and a
  // weekly compliance line needs snapshots nothing writes.
  const trend = page.locator('.pn-card').filter({ hasText: 'Weekly SLA compliance trend' });
  await expect(trend.getByText('Sample', { exact: true })).toBeVisible();

  for (const panel of ['Service Fulfillment', 'Concierge Pipeline']) {
    const card = page.locator('div').filter({ hasText: new RegExp(`^${panel}`) }).first();
    await expect(card.getByText('Sample', { exact: true }).first()).toBeVisible();
  }
});


