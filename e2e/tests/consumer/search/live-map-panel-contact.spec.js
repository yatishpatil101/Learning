import { test, expect } from '@playwright/test';
import { API, authHeaders, signedInAsNew, grantAadhaarBadge } from '../../../helpers/liveAuth.js';

/* Map-view detail panel "Contact Owner", against the live catalogue.
 *
 * The claim: the drawer's primary CTA behaves exactly like the property-detail page's. A signed-in
 * buyer starts an in-app chat request routed into /messages — not the old number-reveal enquiry
 * popup. And per ADR-019 the Aadhaar badge is a badge, not a gate: an unverified buyer reaches an
 * ordinary owner with no verification detour.
 *
 * ## What the mock version could not have caught
 *
 * It fabricated the villa in `puneNestDB_v5` and the buyer in `puneNestUser`, then asserted the
 * navigation. Both halves of the ADR-019 pair were therefore statements about localStorage keys the
 * test itself had written a moment earlier — including `puneNestAadhaar:<buyer>`, the flag the mock
 * gate read. Live, sign-in is a real session (`AuthContext` 401s on a forged one and
 * `ProtectedRoute` bounces it), the badge is granted server-side through the same webhook path a
 * real DigiLocker callback takes, and the listing is seeded row `p5150`.
 *
 * ## The pair has to actually be a pair
 *
 * Two tests that differ only in a call nobody checked are one test run twice — and this pair's
 * whole point is that the *difference* does not matter. `grantAndProve` below reads
 * `aadhaarVerified` off `/auth/me` on both sides of the grant, so a `simulate` endpoint that
 * quietly no-ops fails here loudly instead of turning the verified case into a second copy of the
 * unverified one. See its comment for why the first draft — a field-agnostic diff — could not.
 *
 * ## The deep link
 *
 * `messagesLinkForProp` keys off the view model's `id`, and `propertyMapper.toViewModel` sets
 * `id: p.slug || p.id` — so for a seeded listing it is the slug, and for an owner-created one with
 * no slug yet it would be the UUID. The expected token is read from the API rather than spelled
 * out, so this keeps working if `p5150` is ever re-slugged.
 */

const SLUG = 'p5150';

/** The marker label `PropertyMap` computes for a sale listing (`PropertyMap.jsx:15`). */
const markerLabel = (price) => (price >= 1e7
  ? '\u20B9' + (price / 1e7).toFixed(2) + 'Cr'
  : '\u20B9' + Math.round(price / 1e5) + 'L');

/**
 * The Baner buy stock, and the one row this spec pins a marker on.
 *
 * The click target is a computed price label, so it is only a usable selector while it is unique
 * among the markers on screen. Asserting that here means a future Baner listing priced at
 * ₹2.73 Cr fails with "two markers share this label" rather than by silently opening somebody
 * else's drawer and failing three assertions later on the title.
 */
async function banerVilla() {
  const res = await fetch(`${API}/properties?deal=buy&localities=baner&size=100`);
  expect(res.ok, `GET /properties -> ${res.status}`).toBe(true);
  const rows = (await res.json()).content || [];

  const villa = rows.find((p) => p.slug === SLUG);
  expect(villa, `${SLUG} is not in the Baner buy stock; the seed fixture did not load`).toBeTruthy();
  expect(villa.lat != null && villa.lng != null, `${SLUG} has no coordinates, so it cannot be pinned`).toBe(true);

  const label = markerLabel(villa.price);
  const sharing = rows.filter((p) => p.lat != null && p.lng != null && markerLabel(p.price) === label);
  expect(sharing.map((p) => p.slug), `more than one Baner marker reads "${label}"`).toEqual([SLUG]);

  return { villa, label };
}

/** Open the map view and click the villa's marker. Returns the drawer, asserted open. */
async function openDrawer(page, label) {
  await page.goto('/listings?deal=buy&view=map&loc=baner');
  const marker = page.locator('.price-marker', { hasText: label }).first();
  await marker.waitFor({ timeout: 20000 });
  await marker.click();

  const drawer = page.locator('.pn-mdp');
  await expect(drawer, 'the marker click did not open the detail drawer').toBeVisible({ timeout: 10000 });
  return drawer;
}

/** `/auth/me` for a mobile, over a real session. */
async function me(mobile) {
  const res = await fetch(`${API}/auth/me`, { headers: await authHeaders(mobile) });
  expect(res.ok, `GET /auth/me -> ${res.status}`).toBe(true);
  return res.json();
}

/**
 * Grant the badge and prove it landed.
 *
 * This started out field-agnostic — diff every key on `/auth/me` across the grant and assert
 * *something* moved, so no column name had to be kept in step with the API. That guard was
 * vacuous, and provably so: no-opping `grantAadhaarBadge` left both tests below green. Every
 * `/auth/me` here carries its own fresh login, so the server bumps `lastActive` on the read
 * itself and the diff is non-empty whether or not the grant did anything. "Something changed"
 * is not a claim about the grant when the act of looking changes something.
 *
 * So it names the field. `aadhaarVerified` is on the wire contract these two tests rest on, and
 * a rename breaking this is the right outcome rather than a maintenance cost. The `false` before
 * the grant matters as much as the `true` after: without it a server that ships every account
 * pre-verified would satisfy the second half on its own, and the "verified buyer" test would
 * again be the unverified one wearing a different name.
 */
async function grantAndProve(mobile) {
  const before = await me(mobile);
  expect(
    before.aadhaarVerified,
    'a freshly-minted account is already Aadhaar-verified, so granting the badge cannot be what '
    + 'distinguishes this test from the unverified one below',
  ).toBe(false);

  await grantAadhaarBadge(mobile);

  const after = await me(mobile);
  expect(
    after.aadhaarVerified,
    'granting the Aadhaar badge did not verify the account, so the "verified buyer" here is just '
    + 'the unverified buyer again and this pair proves nothing',
  ).toBe(true);
}

test('a verified buyer reaches the owner from the map drawer, in the app and not by phone', async ({ page }) => {
  const { villa, label } = await banerVilla();
  const mobile = await signedInAsNew(page);
  await grantAndProve(mobile);

  const drawer = await openDrawer(page, label);
  await drawer.getByRole('button', { name: /Contact Owner/i }).click();

  // Straight into the thread for this listing. No number-reveal popup, no interstitial.
  await expect(page).toHaveURL(new RegExp(`/messages\\?openProp=${villa.slug}`, 'i'));
  await expect(page.getByText(/Waiting for the owner to accept/i)).toBeVisible({ timeout: 10000 });
});

test('an unverified buyer reaches the same owner the same way (badge-not-gate, ADR-019)', async ({ page }) => {
  /* Verification is an opt-in badge, never a wall. This owner has not asked for "verified contacts
     only", so an ordinary signed-in buyer gets the identical pending-request chat — no Aadhaar
     prompt, no DigiLocker detour, no difference at all from the test above. That sameness is the
     assertion: the failure this guards against is a gate added here in good faith. */
  const { villa, label } = await banerVilla();
  const mobile = await signedInAsNew(page);
  /* This test's whole content is that the buyer is NOT verified, so it says so rather than
     borrowing the guarantee from its sibling. Without this line the pair's distinctness rests on
     the other test's `before.aadhaarVerified === false` failing first — true today, but it means
     skipping that test quietly turns this one into an unlabelled duplicate. */
  expect(
    (await me(mobile)).aadhaarVerified,
    'this buyer is already Aadhaar-verified, so this is the verified test again under another name',
  ).toBe(false);

  const drawer = await openDrawer(page, label);
  await drawer.getByRole('button', { name: /Contact Owner/i }).click();

  await expect(page).toHaveURL(new RegExp(`/messages\\?openProp=${villa.slug}`, 'i'));
  await expect(page.getByText(/Waiting for the owner to accept/i)).toBeVisible({ timeout: 10000 });
});
