/* The consolidation sweep: what the back office stopped having, and what replaced it.
 *
 * ## What this file is for, and why every test now has two halves
 *
 * A round of consolidation removed a nav item, two analytics tabs, two content tabs and a progress
 * panel, and added cross-links between the pages that survived. This spec was written to keep them
 * gone. Every assertion in it was `toHaveCount(0)` or `toBeHidden()`, which is the weakest possible
 * shape: a page that fails to load, a route that 404s, a login that silently did not happen and a
 * typo'd selector all produce zero matches, and all of them pass. Eighteen tests could have been
 * asserting nothing at all and the suite would have stayed green.
 *
 * So each test now anchors on something that must be *present* on the same page — a heading, a tab
 * that stayed, a card — before asserting the removed thing is absent. The negative is still the
 * point; the positive is what makes the negative mean anything.
 *
 * Three mechanical fixes came with it: the hardcoded `http://localhost:5173` is gone (it ignored
 * `BASE_URL`, so this file silently tested the wrong server whenever the port moved), the private
 * `loginAsAdmin` is replaced by the shared `login` fixture, and four `waitForTimeout` sleeps are
 * replaced by the anchor assertions — a fixed 500ms is both slower than it needs to be and a
 * flake waiting for a slow machine.
 *
 * ## Why this is not a live spec
 *
 * It should be. It is not, and the reason is worth writing down rather than discovering again:
 * `AdminAnalytics`, `AdminContent`, `AdminFinance`, `AdminEnquiries` and `AdminServices` all still
 * import from `lib/mockApi.js` and read nothing from the API. Promoting these tests to
 * `playwright.live.config.js` would not make them test the live platform — it would run exactly the
 * same localStorage-backed pages under a name that claims otherwise, which is worse than leaving
 * them here honestly labelled. The two surfaces on this page that *are* live-backed already have
 * live specs: `/admin/staff-activity` (`admin/live-staff-activity.spec.js`) and the audit log it
 * cross-links to. Recorded in tasks/todo.md.
 */
import { test, expect } from '../../fixtures/base.js';

/** Every test starts signed in as admin on a known page; the fixture handles the OTP dance. */
async function openAdmin(page, login, path) {
  await login.asAdmin();
  await page.goto(path);
}

// ─── Support → Services redirect ───

test('/admin/support redirects to /admin/services', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/support');
  await page.waitForURL('**/admin/services');
  // Landing on the URL is not the claim — the claim is that the redirect lands somewhere real.
  await expect(page.getByRole('heading', { name: 'Service Requests' })).toBeVisible();
});

test('Support nav item is removed from sidebar', async ({ page, login }) => {
  await openAdmin(page, login, '/admin');
  // Anchor on a nav item that stayed: if the sidebar itself failed to render, the absence of
  // Support below would be free.
  await expect(page.locator('nav a[href="/admin/services"]').first()).toBeVisible();
  await expect(page.locator('nav a[href="/admin/support"]')).toHaveCount(0);
});

// ─── Analytics: the Revenue and Conversion tabs moved out ───

test('Analytics no longer shows Revenue or Conversion tabs', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/analytics');
  // The page is up and its tab strip has rendered — established before asserting what is missing
  // from it. `Traffic` is the first tab and is not flag-gated away in the default fixture, so it is
  // the cheapest proof that the strip exists at all. Revenue moved to Finance and Conversion to the
  // Enquiries funnel; both are asserted to exist there further down, so this pair is a move rather
  // than a deletion.
  //
  // Note the role: `Tabs` renders `role="tab"`, not plain buttons. The original asserted
  // `getByRole('button', { name: 'Conversion' })` had count 0 — which was true, and would have
  // stayed true if the Conversion tab were still sitting right there as a `tab`. That is the exact
  // failure mode this rewrite is about: a negative that could not fail.
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Traffic' })).toBeVisible();

  await expect(page.getByRole('tab', { name: /Revenue/i })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Conversion/i })).toHaveCount(0);
  await expect(page.locator('button:has-text("Revenue")')).toHaveCount(0);
});

// ─── Staff Activity ───

test("Staff Activity drops Today's Progress and cross-links the audit log", async ({ page, login }) => {
  await openAdmin(page, login, '/admin/staff-activity');
  await expect(page.getByRole('heading', { name: 'Staff Activity', exact: true })).toBeVisible();

  // The cross-link is the replacement for the panel: the same question ("what happened today?")
  // answered by the log that actually records it. Asserting both in one test keeps them tied —
  // the panel being gone is only correct because the link is there.
  await expect(page.getByText('View Audit Log')).toBeVisible();
  await expect(page.getByText("Today's Progress")).toHaveCount(0);
});

// ─── Content: Localities and City Demand moved out; four tabs remain ───

test('Content page shows exactly the four surviving tabs', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/content');

  await expect(page.getByRole('button', { name: 'Banners' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'FAQs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Announcements' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reviews' })).toBeVisible();

  // Localities has its own page (`/admin/localities`) and City Demand was retired outright.
  await expect(page.getByRole('button', { name: /Localities/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /City Demand/i })).toHaveCount(0);
});

test('Content opens on Banners', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/content');
  await expect(page.getByText('Promotional banners')).toBeVisible();
});

test('Content Reviews tab shows reviews with correct author names', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/content');
  await page.getByRole('button', { name: 'Reviews' }).click();
  await expect(page.getByText('Moderate user reviews')).toBeVisible();
  // A real name, not the 'User' fallback: the fallback firing for every row was the defect this
  // test was written for, and it is invisible unless a specific name is named.
  await expect(page.getByRole('table').getByText('Gauri Rao')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' }).first()).toBeVisible();
});

// ─── Finance: where Revenue went ───

test('Finance page shows Deal Pipeline card with link to Enquiries', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/finance');
  await expect(page.getByText('Deal Pipeline')).toBeVisible();
  await expect(page.getByRole('link', { name: /View all deals/i })).toBeVisible();
});

// ─── Settings ───

test('Settings Audit Log shows Staff Activity cross-link', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/settings');
  // The original wrapped this in `if (await auditBtn.isVisible())`, so a settings page that had
  // lost its audit tab entirely would have passed by skipping the whole assertion. If the tab is
  // gone, that is the failure, not a reason to stop looking.
  await page.getByRole('button', { name: /Audit/i }).click();
  await expect(page.getByText('View Staff Activity')).toBeVisible();
});

// ─── No page errors ───

test('admin dashboard loads without errors', async ({ page, login, consoleErrors }) => {
  await openAdmin(page, login, '/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

test('admin services page loads without errors', async ({ page, login, consoleErrors }) => {
  await openAdmin(page, login, '/admin/services');
  await expect(page.getByRole('heading', { name: 'Service Requests' })).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

/* The /admin/analytics load-without-errors sweep lives in admin/live-analytics-page.spec.js,
   which is where analytics.spec.js was converted to. The copy that used to sit here was
   byte-identical, so it bought a second admin login and page load for nothing. */

// ─── Enquiries module ───

test('admin enquiries page loads with KPIs and tabs', async ({ page, login, consoleErrors }) => {
  await openAdmin(page, login, '/admin/enquiries');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();

  await expect(page.getByText('Enquiries', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Open leads')).toBeVisible();
  await expect(page.getByText('Site visits')).toBeVisible();
  await expect(page.getByText('Deal GMV')).toBeVisible();

  await expect(page.getByRole('button', { name: /Enquiries/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Visits/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Deals/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Funnel/ })).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

test('enquiries Funnel tab shows conversion funnel', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/enquiries');
  await page.getByRole('button', { name: /Funnel/ }).click();
  // This is where Analytics' Conversion tab went, so its absence above is a move, not a loss.
  await expect(page.getByRole('heading', { name: 'Conversion Funnel' })).toBeVisible();
  await expect(page.getByText('Platform-wide Conversion Rates')).toBeVisible();
  await expect(page.getByText('Breakdown by Locality')).toBeVisible();
});

test('enquiries Visits tab shows scheduled visits', async ({ page, login }) => {
  await openAdmin(page, login, '/admin/enquiries');
  await page.getByRole('button', { name: /Visits/ }).click();
  await expect(page.getByText('Visit date')).toBeVisible();
});

// ─── Flatmates module ───
//
// Three tests lived here that drove `/admin/flatmates`, which is retired (wave 2c part 3):
// it moderated seekers, groups and group applications out of `db.json`, could not see rooms,
// and had no view of the D72 publication axis. The route now redirects to `/ops/flatmate-review`,
// which does the same three jobs against the real API. The behaviour they asserted is covered by
// `ops/live-flatmate-moderation.spec.js`, and the redirect itself by `admin/flatmates.spec.js`.
