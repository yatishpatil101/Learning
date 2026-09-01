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
 * Neither half held, and the second one resolved the other way. Geography has read
 * `listLocalities()` — `GET /localities`, with measured `listingCount`, `demand` and
 * `ratePerSqft` — since register 36. Seasonal is **gone** (D252): seasonality needs several years of
 * history the platform has not lived through, so the tab drew a seeded PRNG behind a banner, and a
 * chart that cannot be sourced does not become sourceable by being labelled. The same reasoning
 * removed the six-month price trend, the per-listing price table and the weekly SLA compliance line.
 *
 * ## Why the rendering assertions belong here rather than on the mock config
 *
 * `admin/live-analytics.spec.js` — which stays, and owns the **endpoint contracts** — argued that
 * the labelling was "a rendering contract" that both modes shared, so duplicating it live "would
 * cost a browser launch to learn nothing". That was right about the data source and wrong about the
 * risk: the transition worth catching is a generated panel reappearing on a measured tab, and that
 * happens on the live build, because that is where a tab becomes real.
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

/** Every tab in the strip, in render order. Named once so the "all seven" test cannot drift. */
const TABS = ['Traffic', 'Engagement', 'Anonymous surfers', 'Geography', 'Supply Gap', 'Pricing', 'SLA'];

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

test('analytics opens on Traffic and offers all seven tabs', async ({ page, login }) => {
  await openAnalytics(page, login);
  await expect(page.getByRole('tab', { name: 'Traffic' })).toHaveAttribute('aria-selected', 'true');
  for (const label of TABS) {
    await expect(page.getByRole('tab', { name: label })).toBeVisible();
  }
});

test('analytics does not show a Conversion tab', async ({ page, login }) => {
  await openAnalytics(page, login);
  // Conversion moved to the Enquiries funnel (`admin/live-consolidation.spec.js` asserts it arrived).
  // Anchored on the strip having rendered, so this is "not among these seven" rather than
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

test('a deep link to the retired Seasonal tab falls back to Traffic', async ({ page, login }) => {
  /* Seasonal was a real tab with a real URL, so bookmarks and pasted links to it exist. The tab is
     gone because its numbers were generated (D252), and the failure worth guarding is not the 404
     — `useTabParam` has no such thing — but a blank panel: an unrecognised value that selected
     nothing would leave an operator on a page with a heading and no content, which reads as an
     outage rather than as a removal. */
  await openAnalytics(page, login, 'seasonal');
  await expect(page.getByRole('tab', { name: 'Seasonal' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Traffic' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Sessions & page views')).toBeVisible();
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

test('Pricing tab renders KPI tiles and the locality table', async ({ page, login }) => {
  await openAnalytics(page, login, 'pricing');
  await expect(page.getByText('Listings analysed')).toBeVisible();
  await expect(page.getByText('Locality Pricing Breakdown')).toBeVisible();
});

test('SLA tab renders the review KPI row, the four measured tracks and the targets', async ({ page, login }) => {
  await openAnalytics(page, login, 'sla');
  await expect(page.getByText('Listings reviewed')).toBeVisible();
  await expect(page.getByText('Avg time to review')).toBeVisible();
  await expect(page.getByText('Longest Waiting Listings')).toBeVisible();
  // The three tracks that used to be generated panels or did not exist. `GET /admin/analytics/sla`
  // derives all three from `audit_log` (D252), so a heading here is a claim about served data.
  await expect(page.getByRole('heading', { name: 'Ticket Pickup' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Service Delivery' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Concierge Pipeline' })).toBeVisible();
  await expect(page.getByText('SLA Targets')).toBeVisible();
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

  /* Scoped to the one tile. It used to be scoped because `0h` was legitimately elsewhere on the tab:
     the generated Service Fulfillment and Concierge panels rounded their constants to zero against a
     sparse store, so a page-wide `toHaveCount(0)` failed for a reason that had nothing to do with
     the rule. Those panels are measured now and obey the same rule, so the page-wide sweep below is
     finally meaningful — the narrow assertion is kept as well because it names the tile, and a
     failure that names the tile is the one worth reading. */
  const reviewTile = page.locator('div.rounded-xl').filter({ hasText: 'Avg time to review' });
  await expect(reviewTile).toHaveCount(1);
  await expect(reviewTile).toContainText('not recorded');
  // The specific wrong answer this guards against. A `|| 0` creeping back into `hours()` — whose
  // own comment promises "Never `0h`" — reads as a real measurement of a review that was never timed.
  await expect(reviewTile).not.toContainText('0h');
});

test('nothing anywhere on the SLA tab claims a zero-hour turnaround', async ({ page, login }) => {
  /* The sweep the old file could not make. Every figure on this tab is served from `audit_log` now,
     and every one of them is nullable, so `0h` has no honest source anywhere on the screen: it can
     only be a null coerced through `|| 0`, in `hours()` or in one of the four `Track` panels. That
     coercion is the single most likely regression here, because it looks tidier than the truth.
     `1h`, `24h` and the `< 4h` target chips are all still fine — the pattern is anchored so a
     rounded `10h` cannot match. */
  await openAnalytics(page, login, 'sla');
  await expect(page.getByRole('heading', { name: 'Concierge Pipeline' })).toBeVisible();
  await expect(page.getByText(/(^|[^\d.])0h\b/)).toHaveCount(0);
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

// ─── Nothing on this page is generated any more ───

/* The old file kept two loops and two `Sample`-chip tests here, guarding the labels on the panels
 * that drew seeded random numbers: the whole Seasonal tab, the six-month price trend, the
 * per-listing price table, the weekly SLA compliance line, Service Fulfillment and Concierge
 * Pipeline. Three of those are now measured and three are deleted, so there is no label left to
 * keep honest — the pairing those tests enforced ("a tab either draws measured data or says it does
 * not") is now enforced by there being nothing on the page in the second category.
 *
 * What replaces them is the converse, and it is the stronger assertion: no tab may carry the
 * banner or the chip at all. A generated panel reappearing is caught whether or not whoever added
 * it remembered to label it, which the old loops could not do — they only checked that the labels
 * on a known list of panels were still there. */

test('no analytics tab presents generated numbers', async ({ page, login }) => {
  for (const tab of ['traffic', 'engagement', 'surfers', 'geography', 'supply-gap', 'pricing', 'sla']) {
    await openAnalytics(page, login, tab);
    // Anchored on the tab having actually rendered — a blank panel satisfies a bare
    // `toHaveCount(0)` for free, which is exactly how this assertion would rot.
    await expect(page.locator('[role="tabpanel"], main').first()).toBeVisible();
    await expect(page.getByText('Illustrative data.')).toHaveCount(0);
    await expect(page.getByText('Sample', { exact: true })).toHaveCount(0);
  }
});
