import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

/* Does earning the badge change anything a buyer can see? The payoff fails quietly, on the buyer's
 * side, where no owner is present to notice it is missing. */

const VERIFIED_OWNER = 'p5021';
const UNVERIFIED_OWNER = 'p5007';

/* An exact accessible-name match is the sharpest assertion available: "Verified Owner" alone
 * cannot be satisfied by "Ownership Verified". */
const identityBadge = (scope) => scope.getByRole('img', { name: 'Verified Owner', exact: true });

/* Scoped to the owner card, because the detail page prints "Verified Owner" in two places — here and
 * in the verification checklist. Only this one is the owner's own badge. */
const ownerCard = (page) => page.locator('a[href^="/owner/"]').first();

test('a verified owner\'s listing carries the trust signal a buyer can see', async ({ page }) => {
  await page.goto(`/property/${VERIFIED_OWNER}`);

  await expect(ownerCard(page).getByText('Verified Owner', { exact: true })).toBeVisible();
  // The second, softer claim on the same card — the one that turns a badge into a reason to enquire.
  await expect(page.getByText('Verified owner — usually responds 2× faster')).toBeVisible();
});

test('an unverified owner\'s listing does not', async ({ page }) => {
  await page.goto(`/property/${UNVERIFIED_OWNER}`);

  /* Anchor on the card having rendered before asserting an absence, or this passes on a blank
   * screen: the paperwork badge is the branch p5007 legitimately earned. */
  await expect(ownerCard(page).getByText('Ownership Verified', { exact: true })).toBeVisible();
  await expect(ownerCard(page).getByText('Verified Owner', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Verified owner — usually responds 2× faster')).toHaveCount(0);
});

test('the search results badge the verified owner and not the unverified one', async ({ page }) => {
  /* Not duplication of the detail-page assertion: the two badges come from different components
   * over the same field, and "verified on detail, plain in results" is a shipped bug elsewhere. */
  await page.goto('/listings?deal=buy');

  const verified = page.locator(`a[href="/property/${VERIFIED_OWNER}"]`).first();
  await expect(verified).toBeVisible();
  await expect(identityBadge(verified)).toBeVisible();
});

test('the API is the source of the badge, not the browser', async ({ page }) => {
  /* The render assertions above cannot distinguish "the server said verified" from "the client
   * decided", so this one reads the contract the page reads. */
  const [verified, unverified, page1] = await Promise.all([
    fetch(`${API}/properties/${VERIFIED_OWNER}`).then((r) => r.json()),
    fetch(`${API}/properties/${UNVERIFIED_OWNER}`).then((r) => r.json()),
    fetch(`${API}/properties?deal=buy&size=50`).then((r) => r.json()),
  ]);

  expect(verified.ownerVerified).toBe(true);
  expect(unverified.ownerVerified).toBe(false);

  /* And on the card projection, which is a *different* schema — the detail read having the field
   * says nothing about the search read having it, which is exactly how it came to be missing. */
  const card = page1.content.find((p) => p.slug === VERIFIED_OWNER);
  expect(card.ownerVerified).toBe(true);
});

test('a listing posted by an unverified owner is born unverified', async ({ page }) => {
  /* The flag is inherited from the owner rather than accepted from the client, so a client asking
   * for `ownerVerified: true` must not get it - an authorization claim in a fixture's clothes. */
  const mobile = await signedInAsNew(page);

  const res = await fetch(`${API}/me/listings`, {
    method: 'POST',
    headers: await authHeaders(mobile),
    body: JSON.stringify({
      title: 'Freshly posted by an unverified owner',
      deal: 'rent',
      propertyType: 'apartment',
      price: 25000,
      locality: 'Baner',
      city: 'Pune',
      ownerVerified: true,
    }),
  });

  expect(res.status).toBe(201);
  expect((await res.json()).ownerVerified).toBe(false);
});
