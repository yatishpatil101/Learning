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
    title: `Zztest action center listing ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 24000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 850,
  });
  expect(created.status, 'creating the owner listing').toBe(201);
  createdListingIds.add(created.body.id);

  const approved = await api('PATCH', `/properties/${created.body.id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(approved.status, 'approving the owner listing').toBe(200);
  return created.body;
}

async function ownerContactRequest(owner, propertyId, buyerName) {
  const inbox = await api('GET', '/me/contact-requests?size=50', owner.headers);
  expect(inbox.status, 'reading the owner contact inbox').toBe(200);
  const row = inbox.body.content.find((item) =>
    item.propertyId === propertyId && item.requester?.name === buyerName,
  );
  expect(row, 'the server must show the buyer request to the listing owner').toBeTruthy();
  return row;
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListingIds) {
    const rejected = await api('PATCH', `/properties/${id}/status`, adminHeaders, {
      status: 'rejected',
      reason: 'Zztest cleanup - Action Center fixture',
    });
    expect(rejected.status, `cleaning up isolated listing ${id}`).toBe(200);
  }
  createdListingIds.clear();
});

test('an owner shares a real contact request from the Action Center and clears the Requests badge', async ({ page }) => {
  const owner = await newActor(`Zztest Action Owner ${Date.now()}`);
  const buyer = await newActor(`Zztest Action Buyer ${Date.now()}`);
  const listing = await createApprovedListing(owner);

  const requested = await api('POST', '/contacts/request', buyer.headers, {
    propertyId: listing.id,
    message: 'Please share your contact details after reviewing my request.',
  });
  expect(requested.status, 'creating the buyer contact request').toBe(200);
  expect(requested.body.status).toBe('pending');

  const pending = await ownerContactRequest(owner, listing.id, buyer.name);
  expect(pending.status).toBe('pending');

  await signedInAs(page, owner.mobile);
  const contactInboxRead = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/me/contact-requests'
    && response.request().method() === 'GET'
    && response.status() === 200,
  );
  await page.goto('/dashboard');
  await contactInboxRead;

  const actionCenter = page.getByTestId('action-center');
  await expect(actionCenter).toBeVisible();
  const action = actionCenter.getByTestId('action-item').filter({ hasText: buyer.name });
  await expect(action).toHaveCount(1);
  await expect(action).toContainText(/wants your phone number/i);
  await expect(page.locator('aside button', { hasText: 'Requests' }).first()).toContainText('1');

  const approval = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/me/contact-requests/${pending.id}`
    && response.request().method() === 'PATCH'
    && response.status() === 200,
  );
  await action.getByRole('button', { name: 'Share' }).click();
  await approval;
  await expect(action).toHaveCount(0);

  const approved = await ownerContactRequest(owner, listing.id, buyer.name);
  expect(approved.status, 'Share must persist the owner approval on the server').toBe('approved');

  const pendingCount = await api('GET', '/me/contact-requests/pending-count', owner.headers);
  expect(pendingCount.status).toBe(200);
  expect(pendingCount.body.pending).toBe(0);
});

test('a fresh seeker has an honest empty Action Center and no owner-only Requests navigation', async ({ page }) => {
  const seeker = await newActor(`Zztest Action Seeker ${Date.now()}`);

  await signedInAs(page, seeker.mobile);
  const inboxRead = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/me/contact-requests'
    && response.request().method() === 'GET'
    && response.status() === 200,
  );
  await page.goto('/dashboard');
  const inbox = await inboxRead;
  expect((await inbox.json()).content).toEqual([]);

  await expect(page.getByTestId('verify-badge-cta')).toBeVisible();
  await expect(page.getByTestId('action-center-clear')).toBeVisible();
  await expect(page.getByTestId('action-center')).toHaveCount(0);
  await expect(page.locator('aside button', { hasText: 'Requests' })).toHaveCount(0);
});
