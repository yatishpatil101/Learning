import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

/* One recipient per event, never the actor, and nothing in a body that the contact gate protects.
   Every row is read back from the recipient's own inbox, a place the writing side does not own. */

const createdListings = new Map();
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

/* The sequence byte rules out a same-millisecond `uniqueMobile()` collision, which would read as
   "the actor was told about their own action" rather than as a fixture clash. */
async function actor(name) {
  const base = uniqueMobile();
  const mobile = `${base.slice(0, -1)}${actorSequence++ % 10}`;
  const headers = await authHeaders(mobile);
  const named = await api('PATCH', '/auth/me', headers, { name });
  expect(named.status, `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

async function approvedListing(owner) {
  const created = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest notification types ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 26000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 880,
    images: await uploadedListingPhotos(owner.headers),
  });
  expect(created.status, 'creating the isolated listing').toBe(201);
  createdListings.set(created.body.id, owner.headers);
  const approved = await approveListingWithFetch(created.body.id, await authHeaders(ACTORS.admin));
  expect(approved.status, 'approving the isolated listing').toBe(200);
  return created.body;
}

async function inbox(who) {
  const read = await api('GET', '/notifications?size=100', who.headers);
  expect(read.status, `reading ${who.name}'s inbox`).toBe(200);
  return read.body.content;
}

/** The rows of one type, after asserting the contract every one of them keeps. */
async function rowsOf(recipient, type, from) {
  const rows = (await inbox(recipient)).filter((row) => row.type === type);
  for (const row of rows) {
    expect(row.title, `${type} has a title`).toBeTruthy();
    expect(row.link, `${type} links somewhere the recipient can act`).toMatch(/^\//);
    expect(row.body ?? '', `${type} must not carry a mobile number`).not.toMatch(/(?<!\d)\d{10}(?!\d)/);
    for (const person of from) expect(row.body ?? '', `${type} leaked ${person.name}'s mobile`).not.toContain(person.mobile);
  }
  return rows;
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const [id, ownerHeaders] of createdListings) {
    const reason = { reason: 'Zztest cleanup - notification types fixture' };
    let rejected = await rejectListingWithFetch(id, adminHeaders, reason);
    if (rejected.status === 409) {
      const reopened = await api('POST', `/me/deals/${id}/reopen`, ownerHeaders, {});
      expect(reopened.status, `reopening closed isolated listing ${id}`).toBe(200);
      rejected = await rejectListingWithFetch(id, adminHeaders, reason);
    }
    expect(rejected.status, `cleaning up isolated listing ${id}`).toBe(200);
  }
  createdListings.clear();
});

test.describe('Notification types - live API', () => {
  test('contact, visit, photo and document requests tell the owner, and a cancelled visit tells the other side', async () => {
    const owner = await actor(`Zztest Notif Owner ${Date.now()}`);
    const buyer = await actor(`Zztest Notif Buyer ${Date.now()}`);
    const second = await actor(`Zztest Notif Second ${Date.now()}`);
    const listing = await approvedListing(owner);

    expect((await api('POST', '/contacts/request', buyer.headers, { propertyId: listing.id, message: 'Is it available?' })).status).toBe(200);
    expect((await api('POST', `/properties/${listing.id}/photo-requests`, buyer.headers)).status).toBe(200);
    expect((await api('POST', '/documents/requests', buyer.headers, {
      propertyId: listing.id, categories: ['Society NOC'], acknowledgedDisclaimer: true,
    })).status).toBe(201);

    const slot = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const visit = await api('POST', '/visits', buyer.headers, { propertyId: listing.id, slot, mode: 'in-person' });
    expect(visit.status, 'booking the visit').toBe(201);
    const other = await api('POST', '/visits', second.headers, { propertyId: listing.id, slot, mode: 'in-person' });
    expect(other.status, 'booking the second visit').toBe(201);

    for (const type of ['contact.received', 'photo.requested', 'document.requested']) {
      expect(await rowsOf(owner, type, [buyer]), `the owner is told of ${type}`).toHaveLength(1);
      expect(await rowsOf(buyer, type, [owner]), `${type} is the owner's news, not the requester's`).toHaveLength(0);
    }
    expect(await rowsOf(owner, 'visit.requested', [buyer, second]), 'one visit.requested per visitor').toHaveLength(2);
    expect(await rowsOf(buyer, 'visit.requested', [owner]), 'the visitor is not told of their own booking').toHaveLength(0);

    const ownerCancels = await api('PATCH', `/visit-requests/${visit.body.id}/status`, owner.headers, { status: 'cancelled' });
    expect(ownerCancels.status, 'the owner cancels the first visit').toBe(200);
    const visitorCancels = await api('PATCH', `/visit-requests/${other.body.id}/status`, second.headers, { status: 'cancelled' });
    expect(visitorCancels.status, 'the second visitor cancels theirs').toBe(200);

    expect(await rowsOf(buyer, 'visit.cancelled', [owner]), 'the visitor is told the owner cancelled').toHaveLength(1);
    expect(await rowsOf(owner, 'visit.cancelled', [second]), 'the owner is told the visitor cancelled').toHaveLength(1);
    expect(await rowsOf(second, 'visit.cancelled', [owner]), 'the canceller is not told').toHaveLength(0);
  });

  test('an accepted, declined and countered offer each tell the buyer, and a buyer counter tells the owner', async () => {
    const owner = await actor(`Zztest Offer Owner ${Date.now()}`);
    const buyers = [await actor(`Zztest Offer A ${Date.now()}`), await actor(`Zztest Offer B ${Date.now()}`), await actor(`Zztest Offer C ${Date.now()}`)];
    const listing = await approvedListing(owner);

    const offers = [];
    for (const buyer of buyers) {
      const made = await api('POST', '/offers', buyer.headers, { propertyId: listing.id, amount: 24000 });
      expect(made.status, `${buyer.name} offers`).toBe(201);
      offers.push(made.body);
    }
    expect(await rowsOf(owner, 'offer.received', buyers), 'one offer.received per offer').toHaveLength(3);

    const [accepted, declined, countered] = offers;
    const answer = (offer, body) => api('POST', `/offers/${offer.id}/respond`, owner.headers, body);
    expect((await answer(declined, { action: 'decline' })).status).toBe(200);
    expect((await answer(countered, { action: 'counter', counterAmount: 25500 })).status).toBe(200);
    expect((await answer(accepted, { action: 'accept' })).status).toBe(200);

    for (const [buyer, type] of [[buyers[0], 'offer.accepted'], [buyers[1], 'offer.declined'], [buyers[2], 'offer.countered']]) {
      const rows = await rowsOf(buyer, type, [owner]);
      expect(rows, `${buyer.name} is told of ${type}`).toHaveLength(1);
      expect(rows[0].link).toBe(`/property/${listing.id}`);
      expect(await rowsOf(owner, type, [buyer]), `${type} is the buyer's news, not the owner's`).toHaveLength(0);
    }

    const back = await api('POST', `/offers/${countered.id}/respond`, buyers[2].headers, { action: 'counter', counterAmount: 25000 });
    expect(back.status, 'the buyer counters back').toBe(200);
    expect(await rowsOf(owner, 'offer.countered', buyers), 'the owner is told of the buyer counter').toHaveLength(1);
    expect(await rowsOf(buyers[2], 'offer.countered', [owner]), 'the buyer is not re-told of their own counter').toHaveLength(1);
  });

  test('messages raise one bell row per unread run, and reading the chat clears it', async () => {
    const owner = await actor(`Zztest Msg Owner ${Date.now()}`);
    const buyer = await actor(`Zztest Msg Buyer ${Date.now()}`);
    const listing = await approvedListing(owner);

    expect((await api('POST', '/contacts/request', buyer.headers, { propertyId: listing.id })).status).toBe(200);
    const requests = (await api('GET', '/me/contact-requests?size=50', owner.headers)).body.content;
    const row = requests.find((r) => r.propertyId === listing.id);
    expect(row, 'the owner receives the contact request').toBeTruthy();
    expect((await api('PATCH', `/me/contact-requests/${row.id}`, owner.headers, { status: 'approved' })).status).toBe(200);

    const opened = await api('POST', '/messages', buyer.headers, { propertyId: listing.id, body: 'Is the flat still available?' });
    expect(opened.status, 'the buyer opens the thread').toBe(201);
    const thread = opened.body.id;
    expect((await api('POST', `/messages/${thread}/reply`, buyer.headers, { body: 'Also, is parking included?' })).status).toBe(201);

    expect(await rowsOf(owner, 'message.received', [buyer]), 'two unread messages, one bell row').toHaveLength(1);
    expect(await rowsOf(buyer, 'message.received', [owner]), 'the sender is not told of their own message').toHaveLength(0);

    expect((await api('POST', `/messages/${thread}/read`, owner.headers)).status).toBeLessThan(300);
    expect((await api('POST', `/messages/${thread}/reply`, buyer.headers, { body: 'Following up on the above.' })).status).toBe(201);
    expect(await rowsOf(owner, 'message.received', [buyer]), 'a fresh unread run after reading raises a new row').toHaveLength(2);
  });

  test('the inbox renders every new type under a known chip, without falling back to the unknown-type path', async ({ page }) => {
    const owner = await actor(`Zztest Inbox Owner ${Date.now()}`);
    const buyer = await actor(`Zztest Inbox Buyer ${Date.now()}`);
    const listing = await approvedListing(owner);

    expect((await api('POST', '/contacts/request', buyer.headers, { propertyId: listing.id })).status).toBe(200);
    expect((await api('POST', `/properties/${listing.id}/photo-requests`, buyer.headers)).status).toBe(200);
    expect((await api('POST', '/offers', buyer.headers, { propertyId: listing.id, amount: 24000 })).status).toBe(201);
    const visit = await api('POST', '/visits', buyer.headers, {
      propertyId: listing.id, slot: new Date(Date.now() + 3 * 86_400_000).toISOString(), mode: 'in-person',
    });
    expect(visit.status).toBe(201);

    const warnings = [];
    page.on('console', (message) => {
      if (/Unknown server type/.test(message.text())) warnings.push(message.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({
        necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now(),
      }));
    });
    await signedInAs(page, owner.mobile);
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();

    for (const type of ['contact.received', 'photo.requested', 'offer.received', 'visit.requested']) {
      const [row] = await rowsOf(owner, type, [buyer]);
      expect(row, `${type} reached the owner`).toBeTruthy();
    }
    await expect(page.locator('.notif', { hasText: 'New visit request' })).toBeVisible();
    await expect(page.locator('.notif', { hasText: 'New offer on' })).toBeVisible();
    // A contact request and a photo request are both enquiries on one link, so the inbox folds them into one row.
    await expect(page.locator('.notif', { hasText: '2 new enquiries' })).toBeVisible();
    expect(warnings, 'a server type missing from notificationMapper renders as a grey system row').toEqual([]);
  });
});
