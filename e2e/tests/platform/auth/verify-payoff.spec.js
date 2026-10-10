import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, signedInAsNew } from '../../../helpers/liveAuth.js';

// The payoff fails quietly, on the buyer's side, where no owner is present to notice it is missing.
const VERIFIED_OWNER = 'p5021';
const UNVERIFIED_OWNER = 'p5007';

const identityBadge = (scope) => scope.getByRole('img', { name: 'ID verified owner', exact: true });

// Scope to owner card because detail pages print "Verified Owner" twice.
const ownerCard = (page) => page.locator('a[href^="/owner/"]').first();

test('a verified owner\'s listing carries the trust signal a buyer can see', async ({ page }) => {
  await page.goto(`/property/${VERIFIED_OWNER}`);

  await expect(ownerCard(page).getByText('Verified owner')).toBeVisible();
  await expect(page.getByText('Verified listing contact — usually responds 2× faster')).toBeVisible();
});

test('an ownership-badged listing without identity verification does not claim faster replies', async ({ page }) => {
  await page.goto(`/property/${UNVERIFIED_OWNER}`);

  await expect(ownerCard(page).getByText('Verified property')).toBeVisible();
  await expect(page.getByText('Verified listing contact — usually responds 2× faster')).toHaveCount(0);
});

test('the search results badge the verified owner and not the unverified one', async ({ page }) => {
  // Results and detail badges are separate components over the same field.
  await page.goto('/listings?deal=buy');

  const verified = page.locator(`a[href="/property/${VERIFIED_OWNER}"]`).first();
  await expect(verified).toBeVisible();
  await expect(identityBadge(verified)).toBeVisible();
});

test('the API is the source of the badge, not the browser', async ({ page }) => {
  // Read the contract so client-invented verification cannot pass.
  const [verified, unverified, page1] = await Promise.all([
    fetch(`${API}/properties/${VERIFIED_OWNER}`).then((r) => r.json()),
    fetch(`${API}/properties/${UNVERIFIED_OWNER}`).then((r) => r.json()),
    fetch(`${API}/properties?deal=buy&size=50`).then((r) => r.json()),
  ]);

  expect(verified.ownerVerified).toBe(true);
  expect(unverified.ownerVerified).toBe(false);

  // Card projection has its own schema, so detail fields do not prove search fields.
  const card = page1.content.find((p) => p.slug === VERIFIED_OWNER);
  expect(card.ownerVerified).toBe(true);
});

test('a listing posted by an unverified owner is born unverified', async ({ page }) => {
  // Owner verification is inherited server-side, never accepted from client input.
  const mobile = await signedInAsNew(page);

  const headers = await authHeaders(mobile);
  const res = await fetch(`${API}/me/listings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Freshly posted by an unverified owner',
      deal: 'rent',
      propertyType: 'apartment',
      price: 25000,
      locality: 'Baner',
      city: 'Pune',
      ownerVerified: true,
      images: await uploadedListingPhotos(headers),
    }),
  });

  expect(res.status).toBe(201);
  const stored = await fetch(`${API}/me/listings/${(await res.json()).id}`, { headers });
  expect((await stored.json()).ownerVerified).toBe(false);
});
