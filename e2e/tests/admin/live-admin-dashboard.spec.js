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
 *
 * ## The queue reads (D249)
 *
 * The last two tests are about a different failure from the one above. The scorecard was already
 * the server's; the *queues* underneath it were not. `AdminDashboard` fetched
 * `listForModeration({}, 'newest')` — a capped page of the newest listings in every status — and
 * then derived from it both the Flagged tile and the two queue cards.
 *
 * Both derivations were wrong past the page cap, and in the direction that hides work rather than
 * inventing it, which is the direction nobody notices:
 *
 *   - `listings.filter(status === 'flagged').length` reported however many flagged rows happened to
 *     fall inside the fetched window. A number that can only ever move downwards, reading on screen
 *     as "the queue is shorter than it is".
 *   - the stale and awaiting-owner cards looked for the listings that had been waiting *longest*
 *     inside a page of the *newest* rows — so the ones the cap discarded were precisely the ones
 *     they existed to surface. The stalest pending listing is the last thing a newest-first page
 *     keeps.
 *
 * The read is now `listForModeration({ status: 'pending', archived: false }, 'oldest')`, and the
 * Flagged tile takes its number from `GET /admin/properties/summary`. Each test below is written so
 * that the *old* code fails it. That takes some care, because both bugs only bite past the page cap
 * and no test may depend on the size of a shared database: the ordering test refuses to run at all
 * unless the two orders disagree, and the Flagged tile is pinned by where its number comes *from*
 * — a screen that never asked the server cannot go blank when the server is not there.
 */
import { expect, test, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

/** The server's own answer, read straight from the contract endpoint the screen is supposed to use. */
async function scorecard(mobile) {
  const headers = await authHeaders(mobile);
  const res = await fetch(`${API}/admin/dashboard`, { headers });
  expect(res.status, 'GET /admin/dashboard').toBe(200);
  return res.json();
}

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
  // A real entry in `GET /localities`, so the resolver files the listing rather than leaving
  // `locality_slug` null and dropping it into the curation queue.
  locality: 'Baner',
};

/* Every uuid this file puts into the shared catalogue, drained by `afterEach`. A module-level set is
   safe because the live config runs `workers: 1`. */
const created = new Set();

/**
 * A pending listing under an owner nobody else shares.
 *
 * Through the owner's own route rather than an admin write, so "pending" is the state the *server*
 * puts a submission in rather than one the fixture asserted into existence.
 */
async function pendingListing(tag) {
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/listings', headers, { ...BASE_LISTING, title: `Zztest dashboard ${tag}` });
  expect(res.status, 'POST /me/listings').toBe(201);
  created.add(res.body.id);
  return res.body.id;
}

/* Rejection rather than deletion, because there is no delete — and because a pending row left on a
   shared database is a row on somebody's real verification queue, not tidy-up debt. */
test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic dashboard fixture',
    });
  }
  created.clear();
});

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

  test('the Flagged tile is the count the server keeps, over a listing the queue has one of', async ({ page, login }) => {
    /* A fixture, rather than reading the tile against a summary of whatever the seed happens to
       hold, because a count both sides derive from an empty catalogue agrees at zero and proves
       nothing. Flagging one listing puts a known row behind the number. */
    const admin = await authHeaders(ACTORS.admin);
    const id = await pendingListing(`flag${Date.now().toString(36)}`);
    const flagged = await api('POST', `/properties/${id}/flag`, admin, {
      reason: 'Zztest \u2014 synthetic flagged fixture',
    });
    expect(flagged.status, 'the flag verb did not accept the fixture').toBeLessThan(300);

    /* Read after the write, and from the endpoint the screen reads, because the catalogue is shared:
       hard-coding a number here would pin whatever else the suite left flagged. */
    const summary = await api('GET', '/admin/properties/summary', admin);
    expect(summary.status, 'GET /admin/properties/summary').toBe(200);
    expect(summary.body.flagged, 'the fixture must make the flagged count non-zero').toBeGreaterThan(0);

    await openDashboard(page, login);
    expect(await tileValue(page, 'Flagged Listings')).toBe(String(summary.body.flagged));
  });

  test('the Flagged tile goes away when the count it quotes is unavailable', async ({ page, login }) => {
    /* This is the leg that fails against the old code, and the equality above is not.
       `listings.filter(status === 'flagged').length` and the server's count agree on any catalogue
       inside the page cap — which the reset lane always is — so the two implementations are
       indistinguishable by number alone, and a test that waited for a hundred-listing database to
       tell them apart would be green on every machine anyone runs it on.

       Where the number comes from is decidable now. Cutting the summary read leaves the new tile
       with nothing to say, and `show: flagged != null` takes it off the page; the old tile derived
       its figure from a request this test does not touch and would still be sitting there with a
       number on it. Asserting a present tile beside the absent one is what stops that from being
       satisfied by a screen that failed to render at all. */
    await page.route('**/admin/properties/summary*', (route) => route.abort());

    await openDashboard(page, login);
    await expect(tile(page, 'Pending Verification')).toBeVisible();
    await expect(tile(page, 'Flagged Listings')).toHaveCount(0);
  });

  test('the pending card is the oldest listings in the queue, not the oldest in a page of the newest', async ({ page, login }) => {
    const admin = await authHeaders(ACTORS.admin);
    const facet = 'status=pending&archived=false&page=0&size=5';

    const oldest = await api('GET', `/admin/properties?${facet}&sort=createdAt,asc`, admin);
    const newest = await api('GET', `/admin/properties?${facet}&sort=createdAt,desc`, admin);
    expect(oldest.status, 'GET /admin/properties sorted ascending').toBe(200);
    expect(newest.status, 'GET /admin/properties sorted descending').toBe(200);

    const titles = (res) => res.body.content.map((p) => p.title);

    /* The premise, asserted rather than assumed — the same guard the Total Users test carries. With
       five or fewer pending listings the two orders hold the same set and this test would pass
       against the old newest-first read, which is exactly the vacuous green the seed is allowed to
       drift into. `PropertySort` appends `id desc` as a total tiebreaker, so both reads are
       deterministic and an array comparison is safe. */
    expect(
      titles(oldest),
      'the queue must hold more than one page of five for oldest-first to be distinguishable from newest-first',
    ).not.toEqual(titles(newest));

    await openDashboard(page, login);

    const card = page.locator('.pn-card').filter({ has: page.getByRole('heading', { name: 'Pending verification' }) });
    await expect(card).toBeVisible();

    /* In order, not as a set. The card is a queue: which five it holds is the paging claim, and the
       order they are in is what tells a moderator which one to open next. */
    await expect(card.locator('.text-sm.font-semibold')).toHaveText(titles(oldest));
  });
});
