import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../../helpers/liveAuth.js';

/**
 * D110 — a buyer standing on a sold or reserved listing is told so, against the real API.
 *
 * ## What the mock version could not prove
 *
 * It wrote `puneNestDeals:<ownerId>` into localStorage and logged in as a buyer. That store is the
 * **owner-scoped** client deal store, and the whole point of D110 is that closed-ness stopped
 * living there: the property now carries a public `dealStatus` mirror so a buyer — who can never
 * read the owner's deal — has an honest answer. Seeding the owner's store and then reading the
 * buyer's screen asserted the exact arrangement D110 replaced, in a process where "owner-scoped"
 * costs nothing because one browser holds both scopes.
 *
 * Here the status is set by the **owner**, over HTTP, through `POST /me/deals/{id}/reserve` and
 * `/close`; the buyer is a different session with a different JWT, and the only way the banner can
 * render is if the server put `dealStatus` on the public `GET /properties/{id}` response. That is
 * the mirror, and it is the thing being tested.
 *
 * ## The two ways a buyer meets a closed deal
 *
 * Closing moves two fields, and they lead to two different screens:
 *
 * - `properties.status` → `rented`/`sold`, which fails the detail page's approval gate, so a
 *   stranger gets an **interstitial**. It used to be the pending-moderation one — "hasn't been
 *   verified yet, check back later" — about a listing that was verified and is never coming back.
 *   Now the gate branches on terminal statuses and says so honestly.
 * - `properties.deal_status` → `closed`, which the **DealPanel** answers for whenever the listing
 *   is still viewable — reachable when staff re-approve a listing without reopening its deal.
 *
 * Both are covered, because a fix to either one alone leaves half the buyers misinformed.
 *
 * ## Why a purpose-built listing rather than a seeded anchor
 *
 * Closing a deal is **destructive and not undone by the reset within a run**: `DealService.close`
 * moves `properties.status` to `rented`/`sold`, which drops the listing out of every
 * approved-floored search. Closing a seeded anchor would silently empty a dozen unrelated specs'
 * catalogues, and `reopen` does not restore the seed's `agreed_price`/counterparty either — so
 * "put it back afterwards" is not available. Each test therefore mints an owner and posts its own
 * rent listing, and may then do whatever it likes to it.
 *
 * The listing is a **rent** listing on purpose: the terminal banner's wording branches on the deal,
 * and "rented out" is the branch the mock file exercised.
 */

/* Photos and an ownership document are what `pending → approved` needs, and a buyer-facing test
   needs an approved listing to stand on. Rather than drive the wizard (which is `live-dup-modal`'s
   job), the listing is posted through the API and approved by an administrator — the same two
   steps, without a third screen's worth of ways to fail. */
const LISTING = {
  title: '2 BHK Flat in Baner',
  deal: 'rent',
  propertyType: 'Flat',
  bhk: 2,
  price: 41000,
  locality: 'Baner',
  city: 'Pune',
  address: 'D110 Deal Visibility Residency, B-1204',
  area: 900,
  areaUnit: 'sqft',
  furnishing: 'semi-furnished',
  description: 'A rent listing that exists so a buyer can be told it is no longer available.',
};

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/* The live database is not reset between runs, so a spec that leaves approved listings behind adds
   a row to every catalogue count in the suite on every run. Rejecting is what a moderator would do
   with a synthetic fixture, and it takes the row back out of public reads. A *closed* listing is
   already out of them — this is belt and braces for the two tests that only reserve. */
const created = new Set();

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic deal-visibility fixture',
    });
  }
  created.clear();
});

/**
 * A fresh owner holding one approved rent listing.
 *
 * Returns only an id: `PropertyResponse` carries **no `slug`** for a listing posted through the
 * API — slugs like `p5021` belong to the seeded catalogue. The uuid is what both surfaces take,
 * `GET /properties/{id}` and `/property/{id}` in the browser, so there is no second identifier to
 * keep in step. Probed rather than assumed: an earlier draft read `body.slug`, got `undefined`,
 * and would have navigated to `/property/undefined`.
 */
async function ownerWithApprovedListing() {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);

  const listing = await api('POST', '/me/listings', headers, LISTING);
  expect(listing.status, `posting the listing (${JSON.stringify(listing.body)})`).toBe(201);
  const { id } = listing.body;
  expect(id, 'the server issued an id').toBeTruthy();
  created.add(id);

  const approved = await api('PATCH', `/properties/${id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(approved.status, 'approving the listing').toBe(200);

  return { mobile, headers, id };
}

/** What the *public* detail endpoint says — the mirror the buyer's browser actually reads. */
async function publicDealStatus(id) {
  const res = await fetch(`${API}/properties/${id}`);
  expect(res.status, `reading /properties/${id}`).toBe(200);
  return (await res.json()).dealStatus;
}

test.describe('Deal visibility — a buyer learns a listing is sold or reserved (D110)', () => {
  test('a buyer on a rent listing whose deal closed is told it is rented out, not "under review"', async ({ page, login }) => {
    const { headers, id } = await ownerWithApprovedListing();

    /* The before value is asserted, not just the after. Without it a server that shipped every
       listing pre-closed would satisfy the banner assertions below perfectly, and this test would
       be pinning a permanent bug rather than a transition. */
    expect(await publicDealStatus(id), 'a new listing is not already closed').toBe('active');

    const closed = await api('POST', `/me/deals/${id}/close`, headers, {
      agreedPrice: 41000,
      counterpartyMobile: '9812300000',
    });
    expect(closed.status, 'closing the deal as the owner').toBe(200);

    /* Closing moves BOTH fields, and the second one is what shapes this screen: `dealStatus` goes
       `closed` and `properties.status` goes `rented`, which drops the listing out of search. Both
       are asserted because the page below is chosen by `status`, and a regression that stopped
       moving it would otherwise show up only as a confusing copy failure. */
    const after = await (await fetch(`${API}/properties/${id}`)).json();
    expect(after.dealStatus, 'the public mirror reflects the close').toBe('closed');
    expect(after.status, 'closing a rent deal marks the listing rented').toBe('rented');

    await login.asBuyer();
    await page.goto(`/property/${id}`);

    await expect(page.getByRole('heading', { name: 'This property is no longer available' })).toBeVisible();
    await expect(page.getByText(/has been rented out and is closed for new enquiries/i)).toBeVisible();

    /* The wrong answer this test exists to prevent. `rented` is not `approved`, so before the fix
       the gate handed every stranger the pending-moderation interstitial — "hasn't been verified
       yet … check back later" — about a listing that WAS verified and will never come back. */
    await expect(page.getByText('This property is under review')).toHaveCount(0);
    await expect(page.getByText(/hasn't been verified yet/i)).toHaveCount(0);

    // Nothing to negotiate on a done deal.
    await expect(page.getByRole('button', { name: 'Make an offer', exact: true })).toHaveCount(0);
  });

  test('a buyer on a still-live listing whose deal closed sees the banner and NO offer UI', async ({ page, login }) => {
    /* The other route into `closed`, and the one that keeps the DealPanel's own banner honest: a
       deal closes and staff put the listing back on the market (`PATCH /properties/{id}/status`)
       without reopening the deal. `status` is `approved` again, so the full page renders and the
       panel — not the interstitial above — has to answer for the closed deal. */
    const { headers, id } = await ownerWithApprovedListing();
    expect(await publicDealStatus(id), 'a new listing is not already closed').toBe('active');

    const closed = await api('POST', `/me/deals/${id}/close`, headers, {
      agreedPrice: 41000,
      counterpartyMobile: '9812300000',
    });
    expect(closed.status, 'closing the deal as the owner').toBe(200);

    const reapproved = await api('PATCH', `/properties/${id}/status`, await authHeaders(ACTORS.admin), {
      status: 'approved',
    });
    expect(reapproved.status, 're-approving the listing as admin').toBe(200);

    const after = await (await fetch(`${API}/properties/${id}`)).json();
    expect(after.status, 'the listing is viewable again').toBe('approved');
    expect(after.dealStatus, 're-approving does not reopen the deal').toBe('closed');

    await login.asBuyer();
    await page.goto(`/property/${id}`);

    // Positive anchor first: the full page really did render, so the absences below are about the
    // offer UI being suppressed rather than about a page that never mounted. The h1 is *derived*
    // from deal + bhk + locality rather than echoing the posted `title`, so it is asserted in the
    // shape the page composes.
    await expect(page.getByRole('heading', { level: 1, name: '2 BHK Flat for Rent in Baner' })).toBeVisible();
    await expect(page.getByText('This property is no longer available')).toBeVisible();
    await expect(page.getByText(/has been rented out and is closed for new enquiries/i)).toBeVisible();

    // The offer + finalize cards are hidden — a buyer cannot negotiate a done deal.
    await expect(page.getByRole('heading', { name: 'Negotiate the price' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Make an offer', exact: true })).toHaveCount(0);
  });

  test('a buyer on a reserved listing sees the "Under Offer" banner but KEEPS the offer UI', async ({ page, login }) => {
    const { headers, id } = await ownerWithApprovedListing();
    expect(await publicDealStatus(id), 'a new listing is not already reserved').toBe('active');

    const reserved = await api('POST', `/me/deals/${id}/reserve`, headers);
    expect(reserved.status, 'reserving the deal as the owner').toBe(200);
    expect(await publicDealStatus(id), 'the public mirror reflects the reservation').toBe('reserved');

    await login.asBuyer();
    await page.goto(`/property/${id}`);

    await expect(page.getByText('This property is Under Offer')).toBeVisible();
    /* …and a reserved listing still takes offers, so the negotiate card stays live. This is the
       assertion that keeps `reserved` from being implemented as a synonym for `closed`: both
       banners would pass a test that only checked a banner appeared. */
    await expect(page.getByRole('button', { name: 'Make an offer', exact: true })).toBeVisible();
  });

  test('a buyer on an untouched listing sees no deal banner and the normal offer UI', async ({ page, login }) => {
    const { id } = await ownerWithApprovedListing();
    expect(await publicDealStatus(id)).toBe('active');

    await login.asBuyer();
    await page.goto(`/property/${id}`);

    /* Positive anchor before the absences. The property page mounts its right rail after the
       first paint, so "no banner here" is trivially true of a page that has not finished
       rendering — an all-absence test would pass against a blank screen. The offer button is the
       always-present control on this panel for an active listing, so requiring it first is what
       makes the two `toHaveCount(0)` lines mean anything. */
    await expect(page.getByRole('button', { name: 'Make an offer', exact: true })).toBeVisible();
    await expect(page.getByText('This property is no longer available')).toHaveCount(0);
    await expect(page.getByText('This property is Under Offer')).toHaveCount(0);
  });
});
