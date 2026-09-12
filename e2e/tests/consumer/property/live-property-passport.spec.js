import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../../helpers/liveAuth.js';

/**
 * Owner-Hub property passport (`/owner-hub/property/:id`) against the real API.
 *
 * ## What the mock version could not prove
 *
 * It wrote a fully-formed record into `draazyManagedProps:<mobile>` and then read the screen
 * back. Every field the page rendered was a field the spec had just typed, in the same process,
 * under the client's own vocabulary — so the assertions were a statement about `localStorage`
 * agreeing with itself. In particular the seeded record carried `bhkNum: 2`, `type: 'Flat'` and
 * `deal: 'rent'`, which are the **client** names; the wire names are `bhk`, `propertyType` and a
 * `deal` restricted to `buy|rent`. `managedMapper.js` translates between them in both directions,
 * and a mock-seeded spec sits above that mapper and cannot see it at all.
 *
 * Here the record is created over HTTP with the **wire** vocabulary, so the page can only render it
 * correctly if `toManaged()` translated it. That makes the completeness meter a real assertion
 * rather than arithmetic on a literal: `passportChecklist` reads `bhkNum`, which exists only
 * because the mapper derived it from the wire's `bhk`.
 *
 * ## The 80%
 *
 * `passportPercent` is `round(done / 5 * 100)` over five equally-weighted items
 * (`owner-hub/helpers.js`):
 *
 *   basics      `locality && bhkNum && area`  → satisfied by the POST below
 *   furnishing  `furnishing`                  → satisfied
 *   valued      `valuation`                   → satisfied
 *   docs        `docCount > 0`                → **not** satisfied; a new record has no documents
 *   rent        `rented ? (monthlyRent && tenantName) : true` → free, `rented` defaults false
 *
 * Four of five, so **80%**. It is asserted because it is the one number on the page that is
 * *derived* rather than echoed — the four fields feeding it come back over three different mapper
 * transforms (`bhk → bhkNum` via `Number`, `propertyType → type`, `valuation` passed opaque), and
 * any one of them failing to land moves the meter and nothing else on the screen.
 *
 * ## A throwaway owner per file
 *
 * `GET /me/managed-properties` is caller-scoped and returns a bare array, and the seeded actors'
 * managed-property counts are not published as invariants in `docs/system/fixture-registry.md`.
 * Minting an owner keeps this file from depending on a count nobody promised, and keeps the record
 * it creates from showing up in anybody else's hub.
 */

/* The wire shape, deliberately spelled in the server's vocabulary rather than the client's:
   `propertyType` (not `type`), `bhk` as a number (not the `"2 BHK"` label), `deal` from the
   `buy|rent` pattern (`sale` is a 422 here and is the client-side spelling). Sending the client's
   names instead is the mistake this file exists to catch, and it would fail as a 422 rather than
   as a quietly-empty page. */
const RECORD = {
  title: '2 BHK Flat in Baner',
  deal: 'rent',
  propertyType: 'Flat',
  bhk: 2,
  price: 28000,
  locality: 'Baner',
  area: 950,
  areaUnit: 'sqft',
  furnishing: 'semi-furnished',
  valuation: { rent: { mid: 28000 }, sale: { mid: 6500000 }, perSqft: 6800 },
};

/**
 * Register an owner and give them one managed property. Returns the server's id.
 *
 * The id is the server's, never the spec's: `/owner-hub/property/:id` is looked up with
 * `GET /me/managed-properties/{id}`, which parses a UUID. The mock version used the literal
 * `MP-e2e-passport`, which is not one — an id a spec invents is an id no live route can resolve.
 */
async function ownerWithPassport(page, login) {
  const mobile = await login.asNewOwner();
  const headers = await authHeaders(mobile);
  const res = await fetch(`${API}/me/managed-properties`, {
    method: 'POST',
    headers,
    body: JSON.stringify(RECORD),
  });
  expect(res.status, 'creating the managed property').toBe(201);
  const dto = await res.json();
  // The server owns `visibility` and `status` — the create request has no field for either, and
  // the page's "Private" chip is a render of what the server decided, not of what we asked for.
  expect(dto.visibility, 'a new managed record is born private').toBe('private');
  expect(dto.status).toBe('managed');
  expect(dto.id, 'the server issued an id').toBeTruthy();
  return { mobile, id: dto.id, headers };
}

test.describe('Property passport — /owner-hub/property/:id', () => {
  test('redirects to sign in when signed out', async ({ page }) => {
    /* A syntactically valid UUID the server has never issued. The point of this test is the route
       guard, so the id must not be the reason the page fails to render: a malformed id would make
       "the passport did not appear" true for the wrong reason, and the test would still pass with
       the guard deleted. */
    await page.goto('/owner-hub/property/00000000-0000-4000-8000-000000000000');
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
    await expect(page.getByText('Passport completeness')).toHaveCount(0);
  });

  test('renders the passport for the owning user, translated from the wire vocabulary', async ({ page, login }) => {
    const { id } = await ownerWithPassport(page, login);
    await page.goto(`/owner-hub/property/${id}`);

    // Positive anchor first. Everything below is a claim about *this* record having rendered, and
    // an empty or errored hub would satisfy several of them vacuously.
    await expect(page.getByRole('heading', { name: '2 BHK Flat in Baner' })).toBeVisible();

    // Server-owned state, rendered as the visibility chip + the CTA that acts on it.
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Publish as listing/i })).toBeVisible();

    // The derived number. 4 of 5 checklist items — docs is the missing one, and a record created a
    // moment ago genuinely has no documents, so this is the honest value rather than a fixture.
    await expect(page.getByText('Passport completeness')).toBeVisible();
    await expect(page.getByTestId('passport-percent')).toHaveText('80%');

    // The three panels the passport is made of.
    await expect(page.getByRole('heading', { name: 'Document passport' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rent tracking' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Valuation' })).toBeVisible();

    await expect(page.getByRole('link', { name: /My properties/i }).first()).toBeVisible();
  });

  test('a managed property belonging to somebody else is not found', async ({ page, login }) => {
    /* The mock's version of this asked for `MP-does-not-exist` — a string no store could hold, so
       it proved only that a miss renders an empty state. The interesting miss is a record that
       exists and is not yours: `GET /me/managed-properties/{id}` answers **404, not 403**, on
       purpose, so the passport cannot be used to discover that an id is real. Asserting the same
       empty state for a live id is what makes this a scoping test rather than a lookup test. */
    const stranger = uniqueMobile();
    const headers = await authHeaders(stranger);
    const res = await fetch(`${API}/me/managed-properties`, {
      method: 'POST',
      headers,
      body: JSON.stringify(RECORD),
    });
    expect(res.status, "creating the stranger's managed property").toBe(201);
    const theirs = (await res.json()).id;

    // …and it really is readable by the person who owns it, so the absence below is about the
    // viewer rather than about the record.
    const asOwner = await fetch(`${API}/me/managed-properties/${theirs}`, { headers });
    expect(asOwner.status, 'the owner can read their own record').toBe(200);

    await login.asNewOwner();
    await page.goto(`/owner-hub/property/${theirs}`);

    await expect(page.getByRole('heading', { name: 'Property not found' })).toBeVisible();
    await expect(page.getByText('It may have been removed, or the link is incorrect.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to My properties/i })).toBeVisible();
    // The record's own title must not leak through the not-found state.
    await expect(page.getByText('2 BHK Flat in Baner')).toHaveCount(0);
  });

  test('the passport loads with no real console errors', async ({ page, login, consoleErrors }) => {
    const { id } = await ownerWithPassport(page, login);
    await page.goto(`/owner-hub/property/${id}`);
    await expect(page.getByRole('heading', { name: '2 BHK Flat in Baner' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
