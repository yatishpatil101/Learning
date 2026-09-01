/**
 * The consolidation sweep, against the live API — what the back office stopped having, and what
 * replaced it.
 *
 * ## Why this file now exists
 *
 * `admin/consolidation.spec.js` said, in its own header, that it could not be a live spec because
 * `AdminAnalytics`, `AdminContent`, `AdminFinance`, `AdminEnquiries` and `AdminServices` all read
 * `lib/mockApi.js` and nothing from the API. That was true when it was written and is no longer:
 * Finance goes through `services/financeService.js`, Enquiries through `enquiryBoardService`,
 * Content through `adminContentService` and `reviewService`, Services through the ticket API, and
 * Analytics through the analytics endpoints. Only `AdminDashboard` and the audit-log tab of
 * `AdminSettings` still read the browser store, and neither of the two assertions this file makes
 * about them is a claim about where their data came from. So the reason for staying on the mock
 * has expired, and this is the live home for the sweep.
 *
 * ## Every negative is anchored on a positive, for the same reason as before
 *
 * The claims here are almost all removals — a nav item, a tab, a panel — and a removal asserted as
 * `toHaveCount(0)` is the weakest shape a test has. A page that failed to load, a route that
 * 404s, a login that silently did not happen and a typo'd selector all produce zero matches, and
 * all of them pass. So each test establishes something that must be *present* on the same page
 * before asserting the absence beside it. Running live adds a second way to pass for the wrong
 * reason: `services/config.js` falls back to the mock provider with a `console.warn` rather than
 * an error, so a desk reading `db.json` renders a perfectly plausible screen. The anchors below
 * are chosen to be things the live page draws — a table the API filled, a card the server priced —
 * rather than static copy, wherever the assertion allows it.
 *
 * ## What this file deliberately does not re-assert
 *
 * Three of the mock file's tests already have live homes, and repeating them would buy a second
 * admin login and page load for a fact that is being checked next door:
 *
 *   * The four surviving Content tabs and the banners view they open on are owned by
 *     `admin/live-content-desk.spec.js`, which additionally reads the active/archived counts off
 *     the API. Only the *negative* — that Localities and City Demand are gone — is unowned, and
 *     that is the one test kept here.
 *   * The Reviews tab's author column is owned by `tests/live-admin-content.spec.js`, which names
 *     the author of a row it fetched from `GET /admin/reviews` first. The mock version named
 *     `Gauri Rao`, who exists only in `db.json`.
 *   * The Analytics Conversion tab's absence is owned by `admin/live-analytics-page.spec.js`. The
 *     Revenue half is not, so that is what survives here.
 *
 * The enquiries board's masking, reveal and audit trail belong to `admin/live-enquiries.spec.js`;
 * this file covers the shell around them, which is what the consolidation actually moved.
 */
import { test, expect } from '../../fixtures/live.js';

/** Every test starts signed in as admin on a known page; the fixture handles the OTP dance. */
async function openAdmin(page, login, path) {
  await login.asAdmin();
  await page.goto(path);
}

// ─── Support → Services redirect ───

test('/admin/support redirects to the Service Requests desk, which loads clean', async ({ page, login, consoleErrors }) => {
  await openAdmin(page, login, '/admin/support');
  await page.waitForURL('**/admin/services');

  /* Landing on the URL is not the claim — the claim is that the redirect lands somewhere real.
     `AdminServices` renders this heading from both of its branches, the board and the "the API is
     not enabled in this build" notice, and it does that *because* of this assertion: an operator
     who followed a redirect needs to be told where they arrived before being told what is wrong.
     So the heading alone cannot distinguish a served board from a refused one, and the table is
     what does. It renders its column headers even with no rows, so this stays true on a quiet
     queue and still fails if the desk never got as far as drawing itself. */
  await expect(page.getByRole('heading', { name: 'Service Requests' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('table')).toBeVisible();

  /* The mock file kept this as a separate test that navigated to the same page and asserted the
     same heading. Folded in here: a second admin login and page load to re-reach a screen already
     on the tab is a minute of live suite time for nothing, and the failing line still names which
     half broke. */
  expect(consoleErrors).toHaveLength(0);
});

test('the sidebar offers Services and no longer offers Support', async ({ page, login }) => {
  await openAdmin(page, login, '/admin');

  // Anchor on a nav item that stayed: if the sidebar itself failed to render, the absence of
  // Support below would be free. Scoped to `nav` on purpose — the command palette in the topbar
  // still lists Support, correctly, because the redirect above still works.
  await expect(page.locator('nav a[href="/admin/services"]').first()).toBeVisible();
  await expect(page.locator('nav a[href="/admin/support"]')).toHaveCount(0);
});

// ─── Analytics: the Revenue tab moved to Finance ───

test('Analytics no longer shows a Revenue tab', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/analytics');

  /* `Traffic` is the first tab and is not flag-gated away by default, so it is the cheapest proof
     that the strip rendered at all before anything is asserted to be missing from it.

     Note the role. `Tabs` renders `role="tab"`, not plain buttons, so the original
     `getByRole('button', { name: 'Revenue' })` had count 0 — which was true, and would have stayed
     true with the Revenue tab sitting right there as a `tab`. Both spellings are asserted below
     because the button form is what a rewrite of that component would produce, and a negative that
     cannot fail is worse than no test.

     The Conversion tab's absence is asserted by `admin/live-analytics-page.spec.js`, which owns
     this page. Revenue moved to Finance and Conversion to the Enquiries funnel, and both
     destinations are checked further down — so this is a move rather than a deletion. */
  await expect(page.getByRole('heading', { name: /Analytics/i })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Traffic' })).toBeVisible();

  await expect(page.getByRole('tab', { name: /Revenue/i })).toHaveCount(0);
  await expect(page.locator('button:has-text("Revenue")')).toHaveCount(0);
});

// ─── Staff Activity ───

test("Staff Activity drops Today's Progress and cross-links the audit log", async ({ page, login }) => {
  await openAdmin(page, login, '/admin/staff-activity');
  await expect(page.getByRole('heading', { name: 'Staff Activity', exact: true })).toBeVisible();

  /* The feed is the live anchor. This desk reads `listStaffActivity` from the API and the e2e
     database is never empty of audit rows — the reset replays the seed and every earlier spec in
     the run appends more — so a desk that rendered its heading and then failed its list call
     fails here rather than sailing past on the two assertions below.

     The cross-link is the replacement for the removed panel: the same question ("what happened
     today?") answered by the log that actually records it. Asserting both in one test keeps them
     tied, because the panel being gone is only correct while the link is there. */
  await expect(page.locator('table tbody tr').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /View Audit Log/ })).toBeVisible();
  await expect(page.getByText("Today's Progress")).toHaveCount(0);
});

// ─── Content: Localities and City Demand moved out ───

test('Content has no Localities tab and no City Demand tab', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/content');

  /* The four surviving tabs are enumerated by `admin/live-content-desk.spec.js`, which also pins
     the banners counter against the API. One of them is anchor enough here: it proves the strip
     exists, which is the only thing the two absences below need in order to mean something.

     Localities has its own page at `/admin/localities` and City Demand was retired outright — the
     data behind it now lives on the Analytics Geography and Pricing tabs. */
  await expect(page.getByRole('button', { name: 'Banners', exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: /Localities/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /City Demand/i })).toHaveCount(0);
});

// ─── Finance: where Revenue went ───

test('Finance carries the Deal Pipeline card, and it points at Enquiries', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/finance');
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible();

  await expect(page.getByText('Deal Pipeline')).toBeVisible();

  /* The destination is asserted, not just the label. A card reading "View all deals" that links
     somewhere else is the failure this test exists to catch, and the accessible name alone cannot
     tell the two apart. */
  const link = page.getByRole('link', { name: /View all deals/i });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/admin/enquiries');
});

// ─── Settings ───

test('the Settings audit log cross-links Staff Activity', async ({ page, login }) => {
  /* Deep-linked rather than clicked. `AdminSettings` drives its strip through `useTabParam`, so
     `?tab=audit` is the supported entry point and it removes a click that can land before the tab
     strip has mounted. The tab is still asserted to exist: the original wrapped this whole test in
     `if (await auditBtn.isVisible())`, so a settings page that had lost its audit tab entirely
     passed by skipping every assertion. If the tab is gone, that is the failure, not a reason to
     stop looking — and it would be a silent one here too, because an unrecognised tab id falls
     back to General and the cross-link simply would not render. */
  await openAdmin(page, login, '/admin/settings?tab=audit');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Audit log', exact: true })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /View Staff Activity/ })).toBeVisible();
});

// ─── No page errors ───

test('the admin dashboard loads without errors', async ({ page, login, consoleErrors }) => {
  await openAdmin(page, login, '/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  /* One of the dashboard's reads is live — `listForModeration` fills the pending-verification
     card — and the page returns `<Loading />` until every read in its `Promise.all` has resolved.
     So waiting for a card that sits below that gate is what makes the console-error sweep cover
     the fetches rather than just the first paint, which is the window most of these errors appear
     in. This card is chosen because it renders whether or not the queue has anything in it, so the
     assertion is about the dashboard having loaded, not about what is waiting on it. */
  await expect(page.getByRole('heading', { name: 'Pending verification' })).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

// ─── Enquiries module ───

test('Enquiries shows its four KPI tiles and its four tabs', async ({ page, login, consoleErrors }) => {
  await openAdmin(page, login, '/admin/enquiries');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();

  /* Scoped to `main`, which matters for more than tidiness: the sidebar carries a nav link whose
     text is exactly `Enquiries`, so an unscoped `getByText('Enquiries', { exact: true }).first()`
     resolves to the navigation and passes on a page whose KPI strip never rendered. That is how
     the mock version was written. `Site visits` and `Deal GMV` are filtered out when the
     `enquiries.visits` / `enquiries.deals` admin flags are off; both default to true and the e2e
     settings document does not disable them, so asserting them is a real check on the strip
     rather than on the flags. */
  const main = page.getByRole('main');
  for (const label of ['Enquiries', 'Open leads', 'Site visits', 'Deal GMV']) {
    await expect(main.getByText(label, { exact: true })).toBeVisible();
  }

  /* The tab labels carry a server-derived count in parentheses — `Enquiries (8)` — so matching the
     prefix and letting the count be anything keeps this from duplicating the exact-count assertion
     `admin/live-enquiries.spec.js` makes, while still failing if a tab disappears. */
  for (const label of ['Enquiries', 'Visits', 'Deals', 'Funnel']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  }

  expect(consoleErrors).toHaveLength(0);
});

test("the Enquiries Funnel tab is where Analytics' Conversion tab went", async ({ page, login }) => {
  await openAdmin(page, login, '/admin/enquiries?tab=funnel');

  await expect(page.getByRole('heading', { name: 'Conversion Funnel' })).toBeVisible();
  await expect(page.getByText('Platform-wide Conversion Rates')).toBeVisible();

  /* `Breakdown by Locality` is the one part of this view that is not unconditional: `FunnelView`
     builds its locality map from the enquiries, visits and closed deals in range and renders the
     table only when that map has at least one entry. The default range is unbounded, and the seed
     carries enquiries, so the section is present — which makes this assertion a check that the
     board's list call answered, not just that the funnel component mounted. An empty board would
     draw the two headings above and drop this one. */
  await expect(page.getByText('Breakdown by Locality')).toBeVisible();
});

test('the Enquiries Visits tab lists scheduled visits', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/enquiries?tab=visits');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();

  /* Scoped to the table on purpose. `Table` renders every row twice below the `sm` breakpoint — a
     stacked card list and the table itself, the latter hidden by CSS rather than unmounted — so an
     unscoped text match is ambiguous about which of the two it found. The column header is what is
     being asserted, and it exists only in the table half.

     A row is asserted too, because the header renders from a static column list even when the
     query returned nothing: without it this test would pass against a visits API that answered
     with an empty page. */
  const table = page.getByRole('table');
  await expect(table.getByText('Visit date')).toBeVisible();
  await expect(table.locator('tbody tr').first()).toBeVisible();
});
