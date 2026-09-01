import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

const createdListingIds = new Set();
let actorSequence = 0;

async function api(method, path, headers, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function newActor(name) {
  const base = uniqueMobile();
  const mobile = `${base.slice(0, -1)}${actorSequence++ % 10}`;
  const headers = await authHeaders(mobile);
  const named = await api('PATCH', '/auth/me', headers, { name });
  expect(named.status, `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

async function createApprovedListing(owner) {
  const created = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest deal listing ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 28000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 900,
  });
  expect(created.status, 'creating the isolated deal listing').toBe(201);
  createdListingIds.add(created.body.id);

  const approved = await api('PATCH', `/properties/${created.body.id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(approved.status, 'approving the isolated deal listing').toBe(200);
  return created.body;
}

async function contentFrom(owner, path, description) {
  const response = await api('GET', path, owner.headers);
  expect(response.status, description).toBe(200);
  return response.body.content;
}

async function approveContact(owner, buyer, propertyId) {
  const requested = await api('POST', '/contacts/request', buyer.headers, {
    propertyId,
    message: 'I would like to discuss this listing before finalizing.',
  });
  expect(requested.status, 'creating the contact request needed for finalization').toBe(200);

  const requests = await contentFrom(owner, '/me/contact-requests?size=50', 'reading the owner contact inbox');
  const contact = requests.find((request) => request.propertyId === propertyId && request.requester?.name === buyer.name);
  expect(contact, 'the owner must receive the buyer contact request').toBeTruthy();

  const approved = await api('PATCH', `/me/contact-requests/${contact.id}`, owner.headers, { status: 'approved' });
  expect(approved.status, 'approving buyer contact before finalization').toBe(200);
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListingIds) {
    const rejected = await api('PATCH', `/properties/${id}/status`, adminHeaders, {
      status: 'rejected',
      reason: 'Zztest cleanup - deals and offers fixture',
    });
    expect(rejected.status, `cleaning up isolated listing ${id}`).toBe(200);
  }
  createdListingIds.clear();
});

test('a buyer offer is countered, agreed and accepted through the real deal API', async ({ page }) => {
  const owner = await newActor(`Zztest Deal Owner ${Date.now()}`);
  const buyer = await newActor(`Zztest Deal Buyer ${Date.now()}`);
  const listing = await createApprovedListing(owner);

  await signedInAs(page, buyer.mobile);
  await page.goto(`/property/${listing.id}`);
  await expect(page.getByRole('heading', { name: 'Negotiate the price' })).toBeVisible();
  await page.getByRole('button', { name: 'Make an offer', exact: true }).click();
  await page.getByPlaceholder('e.g. 32000').fill('25000');

  const createdOffer = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/offers'
    && response.request().method() === 'POST'
    && response.status() === 201,
  );
  await page.getByRole('button', { name: 'Send offer' }).click();
  await createdOffer;
  await expect(page.getByRole('heading', { name: 'Your offer' })).toBeVisible();

  const buyerOffers = await contentFrom(buyer, '/offers/mine?size=50', 'reading the buyer offer book');
  const offer = buyerOffers.find((item) => item.propertyId === listing.id);
  expect(offer, 'the buyer offer must persist on the server').toBeTruthy();
  expect(offer.status).toBe('pending');

  const ownerCounter = await api('POST', `/offers/${offer.id}/respond`, owner.headers, {
    action: 'counter',
    counterAmount: 26500,
  });
  expect(ownerCounter.status, 'the owner must be able to counter the buyer offer').toBe(200);

  await signedInAs(page, buyer.mobile);
  await page.goto(`/property/${listing.id}`);
  await expect(page.getByText('Owner countered at')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  const buyerAgreed = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/offers/${offer.id}/respond`
    && response.request().method() === 'POST'
    && response.status() === 200,
  );
  await page.getByRole('button', { name: /^Agree at ₹/ }).click();
  await buyerAgreed;

  const ownerAccepted = await api('POST', `/offers/${offer.id}/respond`, owner.headers, { action: 'accept' });
  expect(ownerAccepted.status, 'the owner must be able to accept the agreed offer').toBe(200);

  const ownerOffers = await contentFrom(owner, '/me/offers?size=50', 'reading the owner offer book after acceptance');
  expect(ownerOffers.find((item) => item.id === offer.id)?.status).toBe('accepted');
});

test('an owner can decline a real finalization request and later accept the buyer retry', async ({ page }) => {
  const owner = await newActor(`Zztest Finalize Owner ${Date.now()}`);
  const buyer = await newActor(`Zztest Finalize Buyer ${Date.now()}`);
  const listing = await createApprovedListing(owner);
  await approveContact(owner, buyer, listing.id);

  const requested = await api('POST', `/finalization/${listing.id}/request`, buyer.headers, {
    propertyId: listing.id,
    counterpartyMobile: owner.mobile,
    agreedPrice: 28000,
  });
  expect(requested.status, 'creating the buyer finalization request').toBe(200);

  const initialRequests = await contentFrom(owner, '/me/finalization-requests?size=50', 'reading pending finalization requests');
  const firstRequest = initialRequests.find((item) => item.propertyId === listing.id);
  expect(firstRequest, 'the owner must receive the buyer finalization request').toBeTruthy();

  const declined = await api('POST', `/finalization/requests/${firstRequest.id}/decline`, owner.headers, {});
  expect(declined.status, 'the owner must be able to decline the request').toBe(200);

  const declinedStatus = await api('GET', `/finalization/${listing.id}/status`, buyer.headers);
  expect(declinedStatus.status, 'reading the buyer declined finalization state').toBe(200);
  expect(declinedStatus.body.status).toBe('declined');

  await signedInAs(page, buyer.mobile);
  await page.goto(`/property/${listing.id}`);
  await expect(page.getByText("The owner hasn't confirmed yet. You can request again.")).toBeVisible();
  /* The public property payload masks the owner number after contact approval. The retry UI therefore
     cannot currently construct FinalizationCreateRequest's required counterpartyMobile; exercise the
     server retry here and report the missing post-approval identity seam as a capability gap. */
  const retried = await api('POST', `/finalization/${listing.id}/request`, buyer.headers, {
    propertyId: listing.id,
    counterpartyMobile: owner.mobile,
    agreedPrice: 28000,
  });
  expect(retried.status, 'the buyer must be able to retry a declined request').toBe(200);

  const retryRequests = await contentFrom(owner, '/me/finalization-requests?size=50', 'reading the buyer retry');
  const retry = retryRequests.find((item) => item.propertyId === listing.id);
  expect(retry, 'the owner must receive the retry').toBeTruthy();

  const accepted = await api('POST', `/finalization/requests/${retry.id}/accept`, owner.headers, {});
  expect(accepted.status, 'the owner must be able to accept the retry').toBe(200);

  const closed = await api('GET', `/properties/${listing.id}`, owner.headers);
  expect(closed.status, 'reading the closed listing').toBe(200);
  expect(closed.body.dealStatus).toBe('closed');
});
