/* /admin/analytics — the eight-tab reporting surface.
 *
 * ## What changed and why
 *
 * Mechanically: the shared `login` fixture replaces a private `loginAsAdmin`, relative paths
 * replace a hardcoded `http://localhost:5173` (which ignored `BASE_URL`, so this file silently
 * tested the wrong server whenever the port moved), and three `waitForTimeout` sleeps are gone —
 * a fixed delay is both slower than it needs to be and a flake waiting for a slow machine.
 *
 * Substantively, three tests were asserting less than they appeared to:
 *
 * - **The CSV export** clicked the button and ended with the comment "no JS error thrown after
 *   click". Nothing checked that. A handler that threw would have been caught by `consoleErrors`
 *   only if the test had asked for it, and one that silently produced no file would have passed
 *   either way. It now waits for the download and checks the filename.
 * - **The anonymous-surfer KPI tiles** looped over `.pn-card .text-2xl` asserting each value was
 *   non-negative. With zero tiles the loop body never runs, so a tab that rendered nothing passed.
 *   The count is now anchored first.
 * - **"does not show Conversion tab"** is a bare `toHaveCount(0)`, which a failed page load
 *   satisfies for free. It is now paired with the tab that is supposed to be there.
 *
 * ## Why this is not (yet) a live spec
 *
 * Six of the eight tabs now read the API: Traffic, Engagement and Anonymous surfers joined Pricing,
 * SLA and Supply Gap. Geography and Seasonal still compute in the browser, so under
 * `playwright.live.config.js` those two would silently exercise localStorage under a name claiming
 * otherwise. The file stays on the mock config until they follow; what it guards there is the
 * page's own behaviour — tab strip, URL sync, deep links, export, and the copy on each card.
 * `admin/live-analytics.spec.js` covers the ported tabs against a real backend.
 * Recorded in tasks/todo.md.
 */
import { test, expect } from '../../fixtures/base.js';

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
  await expect(page.getByLabel('Traffic window')).toContainText('30 days');
});

// ─── The remaining seven tabs ───

test('Engagement tab renders its charts', async ({ page, login }) => {
  await openAnalytics(page, login, 'engagement');
  await expect(page.getByText('Avg. session duration')).toBeVisible();
  await expect(page.getByText('Bounce rate')).toBeVisible();
  await expect(page.getByText('Top pages by views')).toBeVisible();
});

test('Anonymous Surfers tab renders KPI tiles with non-negative values', async ({ page, login }) => {
  await openAnalytics(page, login, 'surfers');
  await expect(page.getByText('Anonymous share')).toBeVisible();
  await expect(page.getByText('Anonymous sessions')).toBeVisible();

  const tiles = page.locator('.pn-card .text-2xl');
  // Anchor the count. Without this the loop below asserts nothing at all when the tab renders no
  // tiles, which is the failure it was written to catch.
  const count = await tiles.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const txt = (await tiles.nth(i).textContent()).trim();
    // An em dash is a legitimate value here: the two rate tiles are null when the window held no
    // sessions to divide by, and printing 0% would assert a measurement that was never taken.
    // Only the numeric case is range-checked, so this stays a real assertion rather than an
    // `|| true` that any string satisfies.
    if (txt === '\u2014') continue;
    expect(parseFloat(txt.replace(/[^0-9.]/g, ''))).toBeGreaterThanOrEqual(0);
  }
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

test('Pricing tab labels the cards it cannot measure', async ({ page, login }) => {
  await openAnalytics(page, login, 'pricing');
  // The six-month trend and the per-listing table are generated — PuneNest keeps no price history
  // and the endpoint reports per locality. Both must say so, or the tab reads as all-measured.
  const trend = page.locator('.pn-card').filter({ hasText: 'Price trend' });
  await expect(trend.getByText('Sample', { exact: true })).toBeVisible();
  const positions = page.locator('div').filter({ hasText: /^Listing Price Position/ }).first();
  await expect(positions.getByText('Sample', { exact: true }).first()).toBeVisible();
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

test('SLA tab renders the review KPI row and targets', async ({ page, login }) => {
  await openAnalytics(page, login, 'sla');
  await expect(page.getByText('Listings reviewed')).toBeVisible();
  await expect(page.getByText('Avg time to review')).toBeVisible();
  await expect(page.getByText('Longest Waiting Listings')).toBeVisible();
  await expect(page.getByText('SLA Targets')).toBeVisible();
});

test('SLA tab reports unmeasured turnaround as unrecorded, not as zero', async ({ page, login }) => {
  await openAnalytics(page, login, 'sla');
  // The mock has no audit log, so it cannot know when a listing was decided. Rendering `0h` there
  // would claim instantaneous review; this is the assertion that stops a `|| 0` creeping back in.
  await expect(page.getByText('not recorded').first()).toBeVisible();
});

test('SLA tab labels the panels it cannot measure', async ({ page, login }) => {
  await openAnalytics(page, login, 'sla');
  // Service tickets and the concierge pipeline are a different domain with no audit trail, and a
  // weekly compliance line needs snapshots nothing writes. All three are checked for the chip
  // rather than merely for being on screen — asserting visibility would keep passing if someone
  // deleted the label, which is the only thing separating these panels from the measured ones.
  const trend = page.locator('.pn-card').filter({ hasText: 'Weekly SLA compliance trend' });
  await expect(trend.getByText('Sample', { exact: true })).toBeVisible();

  for (const panel of ['Service Fulfillment', 'Concierge Pipeline']) {
    const card = page.locator('div').filter({ hasText: new RegExp(`^${panel}`) }).first();
    await expect(card.getByText('Sample', { exact: true }).first()).toBeVisible();
  }
});

test('Seasonal tab renders the demand pattern and events', async ({ page, login }) => {
  await openAnalytics(page, login, 'seasonal');
  await expect(page.getByText('Monthly demand pattern')).toBeVisible();
  await expect(page.getByText('Key seasonal events')).toBeVisible();
  await expect(page.getByText('Year-over-year demand growth')).toBeVisible();
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
