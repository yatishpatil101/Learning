import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

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

const created = new Set();

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListingWithFetch(id, headers, {
      reason: 'Zztest cleanup \u2014 synthetic deal-visibility fixture',
    });
  }
  created.clear();
});

async function ownerWithApprovedListing() {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);

  const listing = await api('POST', '/me/listings', headers, { ...LISTING, images: await uploadedListingPhotos(headers) });
  expect(listing.status, `posting the listing (${JSON.stringify(listing.body)})`).toBe(201);
  const { id } = listing.body;
  expect(id, 'the server issued an id').toBeTruthy();
  created.add(id);

  const approved = await approveListingWithFetch(id, await authHeaders(ACTORS.admin));
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

    expect(await publicDealStatus(id), 'a new listing is not already closed').toBe('active');

    const closed = await api('POST', `/me/deals/${id}/close`, headers, {
      agreedPrice: 41000,
      counterpartyMobile: '9812300000',
    });
    expect(closed.status, 'closing the deal as the owner').toBe(200);

    const after = await (await fetch(`${API}/properties/${id}`)).json();
    expect(after.dealStatus, 'the public mirror reflects the close').toBe('closed');
    expect(after.status, 'closing a rent deal marks the listing rented').toBe('rented');

    await login.asBuyer();
    await page.goto(`/property/${id}`);

    await expect(page.getByRole('heading', { name: 'This property is rented out' })).toBeVisible();
    await expect(page.getByText(/has been rented out and is closed for new enquiries/i)).toBeVisible();

    await expect(page.getByText('This property is under review')).toHaveCount(0);
    await expect(page.getByText(/hasn't been verified yet/i)).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Make an offer', exact: true })).toHaveCount(0);
  });

  test('a buyer on a still-live listing whose deal closed sees the banner and NO offer UI', async ({ page, login }) => {
    const { headers, id } = await ownerWithApprovedListing();
    expect(await publicDealStatus(id), 'a new listing is not already closed').toBe('active');

    const closed = await api('POST', `/me/deals/${id}/close`, headers, {
      agreedPrice: 41000,
      counterpartyMobile: '9812300000',
    });
    expect(closed.status, 'closing the deal as the owner').toBe(200);

    const adminHeaders = await authHeaders(ACTORS.admin);
    const archived = await api('PATCH', `/properties/${id}/archive`, adminHeaders, {
      reason: 'Zztest staging a still-live closed-deal fixture',
    });
    expect(archived.status, 'archiving the closed listing before restore').toBe(200);

    const restored = await api('PATCH', `/properties/${id}/restore`, adminHeaders);
    expect(restored.status, 'restoring the closed listing for review').toBe(200);

    const reapproved = await approveListingWithFetch(id, adminHeaders);
    expect(reapproved.status, 're-approving the listing as admin').toBe(200);

    const after = await (await fetch(`${API}/properties/${id}`)).json();
    expect(after.status, 'the listing is viewable again').toBe('approved');
    expect(after.dealStatus, 're-approving does not reopen the deal').toBe('closed');

    await login.asBuyer();
    await page.goto(`/property/${id}`);

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

    // …and a reserved listing still takes offers, so the negotiate card stays live.
    await expect(page.getByText('This property is Under Offer')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make an offer', exact: true })).toBeVisible();
  });

  test('a buyer on an untouched listing sees no deal banner and the normal offer UI', async ({ page, login }) => {
    const { id } = await ownerWithApprovedListing();
    expect(await publicDealStatus(id)).toBe('active');

    await login.asBuyer();
    await page.goto(`/property/${id}`);

    await expect(page.getByRole('button', { name: 'Make an offer', exact: true })).toBeVisible();
    await expect(page.getByText('This property is no longer available')).toHaveCount(0);
    await expect(page.getByText('This property is Under Offer')).toHaveCount(0);
  });
});
