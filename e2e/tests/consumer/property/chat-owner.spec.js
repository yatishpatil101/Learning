import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
/* A named throwaway account. Registration leaves `name` unset and the owner card falls back to a
   placeholder, so an unnamed owner would let "the owner's name is shown" pass against a constant. */

async function actor(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const res = await api('PATCH', '/auth/me', headers, { name });
  expect(res.status, `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

async function fixture() {
  const owner = await actor('Zztest Chat Owner');
  const res = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest chat-owner ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    bhk: 2,
    price: 27000,
    area: 940,
    areaUnit: 'sqft',
    furnishing: 'semi-furnished',
    city: 'Pune',
    locality: 'Baner',
    address: 'D110 Chat Owner Residency, C-402',
    images: await uploadedListingPhotos(owner.headers),
  });
  expect(res.status, `creating the fixture listing (${JSON.stringify(res.body)})`).toBe(201);
  const id = res.body.id;
  expect(id, 'the server issued an id').toBeTruthy();
  created.add(id);

  const admin = await authHeaders(ACTORS.admin);
  const appr = await approveListingWithFetch(id, admin);
  expect(appr.status, 'approving the fixture listing').toBe(200);

  return { owner, id };
}

async function openTheGate(buyer, owner, propertyId) {
  const req = await api('POST', '/contacts/request', buyer.headers, { propertyId });
  expect(req.status, `requesting contact (${JSON.stringify(req.body)})`).toBe(200);
  expect(req.body.status, 'a fresh request starts pending, not approved').toBe('pending');

  const inbox = await api('GET', '/me/contact-requests', owner.headers);
  expect(inbox.status, 'the owner reading their request inbox').toBe(200);
  const row = (inbox.body?.content ?? []).find((r) => r.propertyId === propertyId);
  expect(row, 'the buyer\'s request reached the owner\'s inbox').toBeTruthy();

  const grant = await api('PATCH', `/me/contact-requests/${row.id}`, owner.headers, { status: 'approved' });
  expect(grant.status, 'the owner approving the request').toBe(200);

  const after = await api('GET', `/contacts/status?propertyId=${propertyId}`, buyer.headers);
  expect(after.status).toBe(200);
  expect(after.body.status, 'the gate is open for this buyer on this listing').toBe('approved');
}

test.afterEach(async () => {
  const admin = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListingWithFetch(id, admin, {
      reason: 'Zztest cleanup \u2014 synthetic chat-owner fixture',
    });
  }
  created.clear();
});

async function openListing(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  await expect(page.getByRole('heading', { level: 1, name: '2 BHK Flat for Rent in Baner' })).toBeVisible({ timeout: 20000 });
}

const contactBtn = (page) => page.getByRole('button', { name: /Contact Owner/i }).first();
const chatLink = (page) => page.getByRole('link', { name: /Chat with Owner/i }).first();

test.describe('Chat with the owner from a listing', () => {
  test('before the owner approves, the page offers "Contact Owner" and not the chat route', async ({ page }) => {
    const { id } = await fixture();
    const buyer = await actor('Zztest Chat Buyer');
    await signedInAs(page, buyer.mobile);
    await openListing(page, id);

    await expect(contactBtn(page)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('link', { name: /Chat with Owner/i })).toHaveCount(0);
  });

  test('clicking "Contact Owner" requests contact, stages the chat and shows it waiting, with no composer', async ({ page }) => {
    const { owner, id } = await fixture();
    const buyer = await actor('Zztest Staging Buyer');
    await signedInAs(page, buyer.mobile);
    await openListing(page, id);

    await contactBtn(page).click();
    const sheetChat = page.locator('.dz-modal').getByRole('button', { name: /Chat with Owner/i });
    await expect(sheetChat).toBeVisible({ timeout: 20000 });
    await sheetChat.click();
    await expect(page).toHaveURL(new RegExp(`/messages\\?openProp=${id}`));

    const ownerInbox = await api('GET', '/me/contact-requests', owner.headers);
    expect(ownerInbox.status, 'the owner can see the pending request').toBe(200);
    expect((ownerInbox.body?.content ?? []).some((row) => row.propertyId === id && row.status === 'pending')).toBe(true);

    const chip = page.locator('.pc-propchip');
    await expect(chip.getByText(/View listing/i)).toBeVisible({ timeout: 20000 });
    await expect(chip.getByRole('link', { name: /View listing/i })).toHaveAttribute('href', `/property/${id}`);
    // The message the seam composed on the buyer's behalf is already in the thread...
    await expect(page.getByText(/interested in/i).first()).toBeVisible();
    await expect(page.getByText(/Waiting for the owner to accept/i)).toBeVisible();
    await expect(page.locator('.pc-input')).toHaveCount(0);
    /* The server was never asked to create this thread, which is the whole point of staging — a
       `POST /messages` here would have been a 403. An empty inbox is the proof. */

    const inbox = await api('GET', '/messages', buyer.headers);
    expect(inbox.status).toBe(200);
    expect(inbox.body.content, 'staging must not have created a server thread').toHaveLength(0);
  });

  test('once the owner approves, the page offers "Chat with Owner" and it opens a real thread', async ({ page }) => {
    const { owner, id } = await fixture();
    const buyer = await actor('Zztest Approved Buyer');
    await openTheGate(buyer, owner, id);
    // A real server thread, created now that the gate permits it. The server derives the owner from the listing.
    const conv = await api('POST', '/messages', buyer.headers, {
      propertyId: id,
      body: 'Zztest — is this flat still available?',
    });
    expect(conv.status, `opening the thread (${JSON.stringify(conv.body)})`).toBe(201);
    expect(conv.body.propertyId, 'the thread is bound to this listing').toBe(id);

    await signedInAs(page, buyer.mobile);
    await openListing(page, id);

    const link = chatLink(page);
    await expect(link).toBeVisible({ timeout: 20000 });
    await expect(link).toHaveAttribute('href', `/messages?openProp=${id}`);
    await expect(page.getByRole('button', { name: /Contact Owner/i })).toHaveCount(0);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/messages\\?openProp=${id}`));

    await expect(page.locator('.pc-propchip').getByText(/View listing/i)).toBeVisible({ timeout: 20000 });
    // The message posted over HTTP is rendered by the page — the thread is the server's, not a stage.
    await expect(page.getByText(/is this flat still available\?/i).first()).toBeVisible();
    await expect(page.locator('.pc-input')).toBeVisible();
    await expect(page.getByText(/Waiting for the owner to accept/i)).toHaveCount(0);
  });
});
