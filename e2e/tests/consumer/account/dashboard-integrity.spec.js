import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const createdListingIds = new Set();
let actorSeq = 0;

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
  const base = uniqueMobile();
  const mobile = `${base.slice(0, -1)}${actorSeq++ % 10}`;
  const headers = await authHeaders(mobile);
  const named = await api('PATCH', '/auth/me', headers, { name });
  expect(named.status, `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

async function approvedListing(owner, title = `Zztest dashboard integrity ${Date.now()}`) {
  const created = await api('POST', '/me/listings', owner.headers, {
    title,
    deal: 'rent',
    propertyType: 'Flat',
    price: 27000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 900,
    images: await uploadedListingPhotos(owner.headers),
  });
  expect(created.status, 'creating listing').toBe(201);
  createdListingIds.add(created.body.id);
  const approved = await approveListingWithFetch(created.body.id, await authHeaders(ACTORS.admin));
  expect(approved.status, 'approving listing').toBe(200);
  return created.body;
}

async function makeContact(owner, listingId, buyerName) {
  const buyer = await actor(buyerName);
  const requested = await api('POST', '/contacts/request', buyer.headers, { propertyId: listingId });
  expect(requested.status, `contact request from ${buyerName}`).toBe(200);
  const inbox = await api('GET', '/me/contact-requests?size=100', owner.headers);
  expect(inbox.status).toBe(200);
  return inbox.body.content.find((row) => row.propertyId === listingId && row.requester?.name === buyerName);
}

async function makePhoto(listingId, buyerName) {
  const buyer = await actor(buyerName);
  const requested = await api('POST', `/properties/${listingId}/photo-requests`, buyer.headers);
  expect([200, 201]).toContain(requested.status);
  return buyer;
}

async function makeDoc(listingId, buyerName, categories = ['Index II']) {
  const buyer = await actor(buyerName);
  const requested = await api('POST', '/documents/requests', buyer.headers, {
    propertyId: listingId,
    categories,
    acknowledgedDisclaimer: true,
  });
  expect(requested.status).toBe(201);
  return { buyer, requestId: requested.body.id };
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListingIds) {
    const rejected = await rejectListingWithFetch(id, adminHeaders, {
      reason: 'Zztest cleanup - dashboard integrity',
    });
    expect(rejected.status, `cleaning ${id}`).toBe(200);
  }
  createdListingIds.clear();
});

test('Action Center count, Requests rows and nav badge agree for mixed pending leads', async ({ page }) => {
  const owner = await actor(`Zztest Integrity Owner ${Date.now()}`);
  const listing = await approvedListing(owner);
  await makeContact(owner, listing.id, 'Zztest Contact Buyer');
  await makePhoto(listing.id, 'Zztest Photo Buyer');
  await makeDoc(listing.id, 'Zztest Doc Buyer', ['Index II', 'Encumbrance Certificate']);

  await signedInAs(page, owner.mobile);
  await page.goto('/dashboard');

  const actionCenter = page.getByTestId('action-center');
  await expect(actionCenter).toBeVisible({ timeout: 20000 });
  await expect(actionCenter.getByText('3 pending')).toBeVisible();
  await expect(page.locator('aside button', { hasText: 'Requests' }).first()).toContainText('3');

  await page.locator('aside button', { hasText: 'Requests' }).first().click();
  await expect(page.getByRole('tab', { name: /All leads/i })).toContainText('3');
  await expect(page.locator('div.group.relative.rounded-xl').filter({ hasText: /Zztest (Contact|Photo|Doc) Buyer/ })).toHaveCount(3);
});

test('more than 20 pending contact requests all appear oldest first', async ({ page }) => {
  const owner = await actor(`Zztest Many Owner ${Date.now()}`);
  const listing = await approvedListing(owner);
  const names = [];
  for (let i = 0; i < 21; i += 1) {
    const name = `Zztest Old Contact ${String(i).padStart(2, '0')}`;
    names.push(name);
    const row = await makeContact(owner, listing.id, name);
    expect(row).toBeTruthy();
  }

  await signedInAs(page, owner.mobile);
  await page.goto('/dashboard');
  const actionCenter = page.getByTestId('action-center');
  await expect(actionCenter.getByText('21 pending')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('action-item').first()).toContainText(names[0]);

  await page.goto('/dashboard#leads');
  const rows = page.locator('div.group.relative.rounded-xl').filter({ hasText: /Zztest Old Contact/ });
  await expect(rows).toHaveCount(21, { timeout: 30000 });
  await expect(rows.first()).toContainText(names[0]);
});

test('double-tapping Accept sends one successful contact decision', async ({ page }) => {
  const owner = await actor(`Zztest Double Owner ${Date.now()}`);
  const listing = await approvedListing(owner);
  const row = await makeContact(owner, listing.id, 'Zztest Double Buyer');
  expect(row).toBeTruthy();

  const successfulPatches = [];
  page.on('requestfinished', async (request) => {
    const response = await request.response();
    if (request.method() === 'PATCH'
      && request.url().endsWith(`/api/me/contact-requests/${row.id}`)
      && response?.status() === 200) {
      successfulPatches.push(request.url());
    }
  });

  await signedInAs(page, owner.mobile);
  await page.goto('/dashboard');
  const accept = page.getByTestId('action-item').filter({ hasText: 'Zztest Double Buyer' }).getByRole('button', { name: 'Accept' });
  await accept.evaluate((button) => { button.click(); button.click(); });
  await expect(page.getByText('Accepted — you can chat now and see their number.')).toBeVisible();
  expect(successfulPatches).toHaveLength(1);

  await page.locator('aside button', { hasText: 'Requests' }).first().click();
  await expect(page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Zztest Double Buyer' })).toContainText('Accepted');
});

test('aborted contact request inbox shows LoadError with retry on All leads', async ({ page }) => {
  await signedInAs(page, ACTORS.owner);
  await page.route('**/api/me/contact-requests?**', (route) => route.abort());
  await page.goto('/dashboard#enquiries');
  await expect(page.getByRole('tab', { name: /All leads/i })).toBeVisible();
  await expect(page.getByText(/couldn't (load every request|reach the server)/)).toBeVisible();
  await expect(page.getByRole('button', { name: /try again|retry/i })).toBeVisible();
  await expect(page.getByText('No leads yet.')).toHaveCount(0);
});

test('document requests from two buyers stay separate and Grant all affects one group', async ({ page, request }) => {
  const owner = await actor(`Zztest Docs Owner ${Date.now()}`);
  const listing = await approvedListing(owner);
  const first = await makeDoc(listing.id, 'Zztest Doc Buyer A', ['Index II']);
  const second = await makeDoc(listing.id, 'Zztest Doc Buyer B', ['Encumbrance Certificate']);

  await signedInAs(page, owner.mobile);
  await page.goto('/dashboard#enquiries');
  await page.getByRole('tab', { name: /Documents/i }).click();
  await expect(page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Zztest Doc Buyer A' })).toHaveCount(1);
  await expect(page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Zztest Doc Buyer B' })).toHaveCount(1);

  await page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Zztest Doc Buyer A' }).getByRole('button', { name: 'Grant all' }).click();
  await expect(page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Zztest Doc Buyer A' })).toContainText('All granted');

  const inbox = await request.get(`${API}/me/documents/requests?size=100`, { headers: owner.headers });
  expect(inbox.status()).toBe(200);
  const rows = (await inbox.json()).content;
  expect(rows.find((row) => row.id === first.requestId).status).toBe('granted');
  expect(rows.find((row) => row.id === second.requestId).status).toBe('pending');
});
