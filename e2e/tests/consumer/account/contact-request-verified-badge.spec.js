import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, grantIdentityBadge, uploadedListingPhotos, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const createdListings = new Set();

async function api(method, path, headers, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function actor(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const named = await api('PATCH', '/auth/me', headers, { name });
  expect(named.status, `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

async function isolatedListing() {
  const owner = await actor(`Zztest Verified Badge Owner ${Date.now()}`);
  const created = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest verified badge listing ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 24000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 850,
    images: await uploadedListingPhotos(owner.headers),
  });
  expect(created.status, 'creating the isolated listing').toBe(201);
  createdListings.add(created.body.id);

  const approved = await approveListingWithFetch(created.body.id, await authHeaders(ACTORS.admin));
  expect(approved.status, 'approving the isolated listing').toBe(200);
  return { owner, id: created.body.id };
}

const maskedMobile = (mobile) => `${mobile.slice(0, 2)}XXXXX${mobile.slice(-3)}`;

async function ownerRequest(request, owner, propertyId, buyer) {
  let row;
  await expect.poll(async () => {
    const response = await request.get(`${API}/me/contact-requests?size=50`, { headers: owner.headers });
    expect(response.status()).toBe(200);
    row = (await response.json()).content.find((item) =>
      item.propertyId === propertyId && item.requester?.mobile === maskedMobile(buyer.mobile));
    return Boolean(row);
  }, { message: 'the owner must receive the new request' }).toBe(true);
  expect(row, 'the owner must receive the new request').toBeTruthy();
  return row;
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListings) {
    const rejected = await rejectListingWithFetch(id, adminHeaders, {
      reason: 'Zztest cleanup - isolated verified badge fixture',
    });
    expect(rejected.status, `cleaning up isolated listing ${id}`).toBe(200);
  }
  createdListings.clear();
});

test('a pending verified buyer keeps the server-provided Serious Buyer badge before approval', async ({ page, request }) => {
  const fixture = await isolatedListing();
  const buyer = await actor(`Zztest Verified Buyer ${Date.now()}`);
  const unverifiedBuyer = await actor(`Zztest Unverified Buyer ${Date.now()}`);

  await grantIdentityBadge(buyer.mobile);
  const profile = await api('PUT', '/me/tenant-profile', buyer.headers, {
    name: buyer.name,
    occupants: 'family',
  });
  expect(profile.status, 'the server must derive the tenant profile badge from identity state').toBe(200);
  expect(profile.body.verified).toBe(true);

  const requested = await request.post(`${API}/contacts/request`, {
    headers: buyer.headers,
    data: { propertyId: fixture.id, message: 'Please share the number after reviewing my verified profile.' },
  });
  expect(requested.status()).toBe(200);
  expect((await requested.json()).status).toBe('pending');

  const unverifiedRequest = await request.post(`${API}/contacts/request`, {
    headers: unverifiedBuyer.headers,
    data: { propertyId: fixture.id, message: 'I am the unverified control for this badge.' },
  });
  expect(unverifiedRequest.status()).toBe(200);
  expect((await unverifiedRequest.json()).status).toBe('pending');

  const before = await ownerRequest(request, fixture.owner, fixture.id, buyer);
  expect(before.status).toBe('pending');
  expect(before.propertyId).toBe(fixture.id);
  expect(before.requester.name).toBeTruthy();
  expect(before.requester.verified, 'only the server may vouch for the requester badge').toBe(true);
  const unverifiedBefore = await ownerRequest(request, fixture.owner, fixture.id, unverifiedBuyer);
  expect(unverifiedBefore.requester.verified, 'the server must distinguish the unverified control').toBe(false);

  await signedInAs(page, fixture.owner.mobile);
  const contactInbox = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/me/dashboard'
    && response.request().method() === 'GET'
    && response.status() === 200,
  );
  await page.goto('/dashboard#enquiries');
  await contactInbox;

  const allLead = page.locator('div.group.relative.rounded-xl').filter({ hasText: before.requester.name }).first();
  await expect(allLead).toBeVisible();
  await expect(allLead).toContainText('Serious Buyer');
  await expect(allLead).toContainText('Number request');
  const unverifiedAllLead = page.locator('div.group.relative.rounded-xl').filter({ hasText: unverifiedBefore.requester.name }).first();
  await expect(unverifiedAllLead).toBeVisible();
  await expect(unverifiedAllLead).not.toContainText('Serious Buyer');

  await page.getByRole('tab', { name: /^Number requests/i }).click();
  const numberRequest = page.locator('div.group.relative.rounded-xl').filter({ hasText: before.requester.name }).first();
  await expect(numberRequest).toBeVisible();
  await expect(numberRequest).toContainText('Serious Buyer');
  await expect(numberRequest).toContainText('Wants to contact you');
  const unverifiedNumberRequest = page.locator('div.group.relative.rounded-xl').filter({ hasText: unverifiedBefore.requester.name }).first();
  await expect(unverifiedNumberRequest).toBeVisible();
  await expect(unverifiedNumberRequest).not.toContainText('Serious Buyer');

  const after = await ownerRequest(request, fixture.owner, fixture.id, buyer);
  expect(after.status, 'viewing the inbox must not approve the request').toBe('pending');
  expect(after.requester.verified).toBe(true);
});