/**
 * `/admin` — the landing dashboard, against the live API.
 *
 * ## Why this file did not exist before, and why that mattered
 *
 * It is the first screen every operator sees after signing in, and until now it had **no spec at
 * all** — neither live nor mock. That is not the usual story of a mock spec waiting for a server to
 * catch up. There was nothing to convert, and the absence is precisely what let the screen rot.
 *
 * `AdminDashboard.jsx` imported seven read functions straight out of `lib/mockApi.js` — below the
 * service seam, so `VITE_API_DOMAINS` could not reach them — and pulled three more panels from
 * `lib/data/analytics-extra.js`, which generates its figures from `rng(314159)`. In live mode the
 * screen therefore rendered browser-invented numbers with a real login in front of them: total
 * users, active listings, revenue, deal counts, both activity cards and the whole platform-health
 * panel. The tiles moved when you cleared localStorage and did not move when the platform did.
 *
 * `live-analytics.spec.js` and `live-analytics-page.spec.js` did not catch it because they drive
 * `/admin/analytics`, a different screen. Nothing pointed at this one.
 *
 * ## What makes these assertions discriminating rather than decorative
 *
 * A dashboard test can pass against fabricated data as easily as against real data — every tile
 * shows *some* number either way. Two properties of the fixtures make these assertions capable of
 * failing:
 *
 * 1. **The live seed and the mock seed disagree.** Live carries 88 users and 71 listings; `db.json`
 *    carries 62 and 80. So an assertion pinned to the server's own answer fails outright if the
 *    screen quietly falls back to the mock — which `services/config.js` does with a `console.warn`,
 *    not an error, so nothing else would tell us.
 * 2. **`totalUsers` cannot be reached by paging.** `GET /users` serves 20 rows a page, and the old
 *    tile counted the array it happened to have fetched. 88 is therefore only obtainable from
 *    `AdminKpis`, and `20` is what regression looks like. The first test asserts that gap is still
 *    there rather than assuming it, so that if the seed ever shrinks below a page the suite says
 *    "this stopped being a discriminator" instead of passing vacuously for ever.
 *
 * Expected values are read from `GET /admin/dashboard` at run time rather than hard-coded. The
 * point is not to pin the seed — other specs create and approve listings, so a hard-coded 71 would
 * rot within a week — it is to prove the *screen* and the *server* agree. A hard-coded number would
 * also happily be satisfied by a client that recomputed it from a page and got lucky.
 *
 * ## The redaction pair
 *
 * `AdminKpis.revenue30d` is the one nullable field: the dashboard is staff-visible but
 * `/admin/finance` is admin-only, so the server sends `null` to staff rather than refusing the whole
 * read (spec fix S61). `fmtINR(null)` renders `₹0`, which is not a redaction but a false figure — and
 * one the finance console would contradict the moment an admin opened it. So the client omits the
 * tile entirely. Both halves are asserted, against the same endpoint, because "staff cannot see
 * revenue" is only proven if an admin demonstrably can.
 *
 * Note the shape of that second test: it asserts a tile that is **always** present before it asserts
 * the one that must be absent. An all-absence test on this page passes trivially — the tiles mount
 * after two round trips, so "no revenue tile" is true of the loading state, of a crashed render, and
 * of a correct redaction alike.
 */
import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** The server's own answer, read straight from the contract endpoint the screen is supposed to use. */
async function scorecard(mobile) {
  const headers = await authHeaders(mobile);
  const res = await fetch(`${API}/admin/dashboard`, { headers });
  expect(res.status, 'GET /admin/dashboard').toBe(200);
  return res.json();
}

/**
 * A KPI tile, located by its label.
 *
 * Every tile is a `<Link>` carrying the formatted figure in one child and the label in another, so
 * the label is the only stable handle — the figure is the thing under test and the icon is
 * decorative. `exact` matters: without it "Total Users" also matches nothing else today, but
 * "Active Listings" would match a future "Active Listings (city)" and silently start asserting
 * about a different tile.
 */
function tile(page, label) {
  return page.locator('a').filter({ has: page.getByText(label, { exact: true }) }).first();
}

/** The formatted number a tile is showing. */
async function tileValue(page, label) {
  const link = tile(page, label);
  await expect(link, `the "${label}" tile is on the page`).toBeVisible();
  return (await link.locator('.text-2xl').innerText()).trim();
}

async function openDashboard(page, login) {
  await login.asAdmin();
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('/admin dashboard — the scorecard is the server\'s', () => {
  test('catalogue tiles render the counts GET /admin/dashboard sent, not a page of them', async ({ page, login }) => {
    await openDashboard(page, login);

    const k = await scorecard(ACTORS.admin);

    /* The premise that makes the next assertion worth making. `GET /users` pages at 20, and the tile
       used to count the array it had in hand; if the seed ever drops below a page, reading 88 stops
       proving anything and this line fails instead of the suite going quietly vacuous. */
    expect(
      k.totalUsers,
      'the seed must hold more users than one page of /users (20), or "Total Users" stops being a discriminator',
    ).toBeGreaterThan(20);

    expect(await tileValue(page, 'Total Users')).toBe(String(k.totalUsers));
    expect(await tileValue(page, 'Active Listings')).toBe(String(k.activeListings));
    expect(await tileValue(page, 'Pending Verification')).toBe(String(k.pendingModeration));

    /* `openReports` is a tile that did not exist before this conversion: `AdminKpis` has carried the
       field since it was written — its javadoc calls it "the second queue tile tech debt D68 was
       waiting for" — and nothing on the front end read it. The abuse queue now has a way in from the
       landing page. */
    expect(await tileValue(page, 'Open Reports')).toBe(String(k.openReports));

    /* The sub-label under Active Listings is the other half of the paging story: `listForModeration`
       returns a capped array, so a browser-side `listings.length` would report the cap once the
       catalogue outgrows it. */
    await expect(tile(page, 'Active Listings')).toContainText(`${k.totalListings} total`);
  });

  test('revenue is served to an admin and withheld from staff, from the same endpoint', async ({ page, login }) => {
    const asAdmin = await scorecard(ACTORS.admin);
    const asStaff = await scorecard(STAFF.rental);

    /* The contract, asserted where it is actually observable — at the seam. Both halves, because
       "staff cannot see revenue" proves nothing unless an admin demonstrably can: an endpoint that
       returned null to everybody would satisfy the second line alone. */
    expect(asAdmin.revenue30d, 'an admin is served a revenue figure').not.toBeNull();
    expect(asStaff.revenue30d, 'staff are served null, not zero').toBeNull();

    /* Everything else on the scorecard is identical for both, which is what makes the null above a
       redaction of one field rather than a differently-scoped read. */
    expect(asStaff.totalUsers).toBe(asAdmin.totalUsers);
    expect(asStaff.pendingModeration).toBe(asAdmin.pendingModeration);

    await openDashboard(page, login);
    await expect(tile(page, 'Revenue (last 30 days)')).toBeVisible();
  });

  test('an ops staffer never reaches the dashboard, so the redaction is defence in depth', async ({ page, login }) => {
    /* This test exists to correct a claim, and the correction is the useful part.
     *
     * `AdminKpis`'s javadoc explains `revenue30d`'s nullability by saying "the dashboard is
     * staff-visible but `/admin/finance` is admin-only". The first half is **not true of the
     * console**: the admin shell is closed to `staff` accounts outright, as
     * `live-rbac.spec.js` puts it — "an operations account cannot open the admin console at all …
     * the atoms they hold widen what the API grants them there, never which shell they may load".
     *
     * So `GET /admin/dashboard` really does answer a staff token — the route's `@PreAuthorize` is
     * `STAFF_OR_ADMIN` and the probe above proves it — but no staffer can reach the screen that
     * calls it. The redaction is therefore defence in depth on the API rather than something a user
     * can watch happen, and `AdminDashboard`'s `revenue30d != null` guard is guarding a case the
     * router currently prevents. Both are worth keeping: the API is the security boundary, and the
     * day an ops role is let into a read-only console the tile must already be absent rather than
     * reading ₹0. Asserting the boundary here is what stops that pairing from silently drifting
     * apart. */
    await login.asStaff('rental');
    await page.goto('/admin');
    await page.waitForURL(/staff-login|\/$/);
    expect(new URL(page.url()).pathname).not.toBe('/admin');
  });
});
