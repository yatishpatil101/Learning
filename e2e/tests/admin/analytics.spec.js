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
 * ## Why this is not a live spec
 *
 * `AdminAnalytics.jsx` imports from `lib/mockApi.js` and reads nothing from the API — every number
 * on this page is computed in the browser from `db.json`. Running these under
 * `playwright.live.config.js` would execute exactly the same localStorage-backed page under a name
 * claiming otherwise. Recorded in tasks/todo.md; the blocker is the page, not the spec.
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
  await expect(page.getByText('Visits & page views')).toBeVisible();
  await expect(page.getByText('Traffic sources')).toBeVisible();
  await expect(page.getByText('Device split')).toBeVisible();
  await expect(page.getByText('New vs returning')).toBeVisible();
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
  await expect(page.getByText('Anonymous sessions')).toBeVisible();
  await expect(page.getByText('Anonymous visits')).toBeVisible();

  const tiles = page.locator('.pn-card .text-2xl');
  // Anchor the count. Without this the loop below asserts nothing at all when the tab renders no
  // tiles, which is the failure it was written to catch.
  const count = await tiles.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const txt = await tiles.nth(i).textContent();
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

test('SLA tab renders the KPI row and trend chart', async ({ page, login }) => {
  await openAnalytics(page, login, 'sla');
  await expect(page.getByText('Overall SLA')).toBeVisible();
  await expect(page.getByText('Weekly SLA compliance trend')).toBeVisible();
  await expect(page.getByText('SLA Targets')).toBeVisible();
});

test('Seasonal tab renders the demand pattern and events', async ({ page, login }) => {
  await openAnalytics(page, login, 'seasonal');
  await expect(page.getByText('Monthly demand pattern')).toBeVisible();
  await expect(page.getByText('Key seasonal events')).toBeVisible();
  await expect(page.getByText('Year-over-year demand growth')).toBeVisible();
});
