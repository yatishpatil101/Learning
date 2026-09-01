import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

/**
 * "Request more photos", end to end against the real API.
 *
 * The retired mock twin read `puneNestPhotoReq:<ownerDigits>` straight out of `localStorage` after
 * the click, so it proved the buyer's own browser remembered the buyer's own tap. The owner half of
 * it seeded that same key by hand and asserted a card rendered from it — meaning the two tests
 * shared no state at all, and the thing this feature exists to do (carry a signal from one person
 * to a different person) was the one thing never exercised.
 *
 * Here the buyer and the owner are separate accounts in separate browser contexts, and every
 * hand-off is read back from a place the writing side does not own.
 *
 * The decline path is new coverage, not a port. `declined` shipped in V118 with no browser test at
 * all, which is how the decision body came to be omitted from the client and broke the live flow:
 * the mock spec asserted a Decline button existed and never pressed it. So both terminal decisions
 * are pressed here, and each is checked in three places — the row the owner sees, the status the
 * server stores, and the notification that reaches the buyer — because those are three different
 * claims and shipping any two without the third is what went wrong last time.
 */

const createdListings = new Set();
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

/**
 * A brand-new account with a known display name.
 *
 * `uniqueMobile()` alone is not quite enough: two actors built in the same millisecond can collide,
 * and the failure that produces is "the owner sees their own request", which reads as a permissions
 * bug rather than a fixture bug. The sequence byte makes that impossible.
 */
async function actor(name) {
  const base = uniqueMobile();
  const mobile = `${base.slice(0, -1)}${actorSequence++ % 10}`;
  const headers = await authHeaders(mobile);
  const named = await api('PATCH', '/auth/me', headers, { name });
  expect(named.status, `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

/**
 * A fresh approved listing owned by a fresh owner.
 *
 * Deliberately not one of the seeded anchor listings: the photo-request inbox is keyed by
 * ownership, so a shared listing would mean a shared inbox, and "exactly one request" — the
 * assertion the whole de-dupe claim rests on — would be true or false depending on what else ran
 * that day.
 */
async function isolatedListing() {
  const owner = await actor(`Zztest Photo Owner ${Date.now()}`);
  const created = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest photo requests listing ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 24000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 850,
  });
  expect(created.status, 'creating the isolated listing').toBe(201);
  createdListings.add(created.body.id);

  const approved = await api('PATCH', `/properties/${created.body.id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(approved.status, 'approving the isolated listing').toBe(200);
  return { owner, id: created.body.id, slug: created.body.slug, title: created.body.title };
}

/** The owner's inbox, read outside the browser. */
async function ownerInbox(owner) {
  const read = await api('GET', '/me/photo-requests?size=50', owner.headers);
  expect(read.status, 'reading the owner photo-request inbox').toBe(200);
  return read.body.content;
}

/** The buyer's notifications, read outside the browser. */
async function notifications(actorWithHeaders) {
  const read = await api('GET', '/notifications?size=50', actorWithHeaders.headers);
  expect(read.status, 'reading the notification inbox').toBe(200);
  return read.body.content;
}

/** Open the owner's Photo requests sub-tab, asserting each step actually happened. */
async function openPhotoRequests(page, owner) {
  await signedInAs(page, owner.mobile);
  await page.goto('/dashboard#enquiries');
  await page.getByRole('tab', { name: /Photo requests/i }).click();
  /* Positive anchor. Every remaining assertion in these tests is scoped to this panel, and an
     all-absence or single-row check inside a panel that never rendered would pass on nothing. */
  await expect(page.getByRole('heading', { name: 'Photo requests' })).toBeVisible();
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListings) {
    const rejected = await api('PATCH', `/properties/${id}/status`, adminHeaders, {
      status: 'rejected',
      reason: 'Zztest cleanup - isolated photo request fixture',
    });
    expect(rejected.status, `cleaning up isolated listing ${id}`).toBe(200);
  }
  createdListings.clear();
});

test('a buyer asking for photos reaches the owner, and asking twice does not', async ({ page }) => {
  const listing = await isolatedListing();
  const buyer = await actor(`Zztest Photo Buyer ${Date.now()}`);

  /* BEFORE. Without this the "exactly one row" assertion below cannot tell a working write from an
     inbox that was already holding a row for some other reason. */
  expect(await ownerInbox(listing.owner), 'the owner inbox starts empty').toEqual([]);

  await signedInAs(page, buyer.mobile);
  await page.goto(`/property/${listing.id}`);

  const ask = page.getByRole('button', { name: /More photos/i });
  await expect(ask).toBeVisible();

  const firstAsk = page.waitForResponse((response) =>
    /\/photo-requests$/.test(new URL(response.url()).pathname) &&
    response.request().method() === 'POST');
  await ask.click();
  expect((await firstAsk).status(), 'the first ask is accepted').toBe(200);
  await expect(page.getByRole('alert')).toContainText(/owner will see it/i);

  /* The load-bearing assertion: the owner's inbox is a different account's read, so a row appearing
     here cannot have come from this browser's storage. It also carries the buyer's *name*, which
     the buyer's browser never sent — the server joined it from the account. */
  const afterFirst = await ownerInbox(listing.owner);
  expect(afterFirst, 'the ask reached the owner').toHaveLength(1);
  expect(afterFirst[0].requester.name).toBe(buyer.name);
  expect(afterFirst[0].propertyId).toBe(listing.id);
  expect(afterFirst[0].status).toBe('pending');

  /* De-dupe. The mock proved this by re-reading the array it had just written; here the second
     press is a real round trip and the owner's inbox is what settles it. */
  await expect(page.getByRole('alert')).toBeHidden({ timeout: 8000 });
  const secondAsk = page.waitForResponse((response) =>
    /\/photo-requests$/.test(new URL(response.url()).pathname) &&
    response.request().method() === 'POST');
  await ask.click();
  expect((await secondAsk).status(), 'the second ask is answered, not rejected').toBe(200);
  await expect(page.getByRole('alert')).toContainText(/already asked/i);

  const afterSecond = await ownerInbox(listing.owner);
  expect(afterSecond, 'asking twice leaves one request, not two').toHaveLength(1);
  expect(afterSecond[0].id, 'and it is the same request, not a replacement').toBe(afterFirst[0].id);
});

test('the owner marks photos added, and the buyer is told where to look', async ({ page }) => {
  const listing = await isolatedListing();
  const buyer = await actor(`Zztest Photo Buyer Added ${Date.now()}`);

  const asked = await api('POST', `/properties/${listing.id}/photo-requests`, buyer.headers);
  expect(asked.status, 'seeding the buyer ask').toBe(200);

  const before = await notifications(buyer);
  expect(before.some((n) => n.type === 'photo.added'), 'the buyer has no photo notification yet').toBe(false);

  await openPhotoRequests(page, listing.owner);
  await expect(page.getByText(buyer.name)).toBeVisible();

  /* The CTA the mock spec asserted, kept: it is the one thing that made the panel actionable, and
     it is still the owner's route to actually adding the photos. The href carries the *slug* where
     the listing has one — `toPhotoRow` prefers it over the UUID, so asserting the UUID here would
     fail against a listing that is perfectly correct. */
  const editTarget = listing.slug || listing.id;
  const cta = page.getByRole('link', { name: /Add photos/i }).first();
  await expect(cta).toHaveAttribute('href', new RegExp(`/list-property\\?edit=${editTarget}`));

  const decided = page.waitForResponse((response) =>
    /\/me\/photo-requests\//.test(new URL(response.url()).pathname) &&
    response.request().method() === 'PATCH');
  await page.getByRole('button', { name: /Mark done/i }).first().click();
  expect((await decided).status(), 'the decision is accepted').toBe(200);
  await expect(page.getByText('Done', { exact: true })).toBeVisible();

  const stored = await ownerInbox(listing.owner);
  expect(stored[0].status, 'the server stores the decision, not just the button state').toBe('resolved');

  /* The third claim, and the one with no coverage before: the buyer finds out. Read as the buyer,
     so a server that recorded the decision but told nobody fails here. */
  const after = await notifications(buyer);
  const told = after.find((n) => n.type === 'photo.added');
  expect(told, 'the buyer is notified that photos were added').toBeTruthy();
  expect(told.title).toBe('More photos added');
  expect(told.link, 'and the link points at the listing they asked about')
    .toBe(`/property/${listing.slug || listing.id}`);
});

test('the owner declines, and the buyer is told there are none coming', async ({ page }) => {
  const listing = await isolatedListing();
  const buyer = await actor(`Zztest Photo Buyer Declined ${Date.now()}`);

  const asked = await api('POST', `/properties/${listing.id}/photo-requests`, buyer.headers);
  expect(asked.status, 'seeding the buyer ask').toBe(200);

  const before = await notifications(buyer);
  expect(before.some((n) => n.type === 'photo.declined'), 'the buyer has no decline notice yet').toBe(false);

  await openPhotoRequests(page, listing.owner);
  await expect(page.getByText(buyer.name)).toBeVisible();

  const decided = page.waitForResponse((response) =>
    /\/me\/photo-requests\//.test(new URL(response.url()).pathname) &&
    response.request().method() === 'PATCH');
  await page.getByRole('button', { name: /^Decline$/ }).first().click();
  expect((await decided).status(), 'the decline is accepted').toBe(200);

  /* "Declined" and "Done" are different words on purpose — reporting a decline as done would tell
     the owner their listing has new pictures that do not exist. */
  await expect(page.getByText('Declined', { exact: true })).toBeVisible();
  await expect(page.getByText('Done', { exact: true })).toHaveCount(0);

  const stored = await ownerInbox(listing.owner);
  expect(stored[0].status, 'the decline is stored as its own terminal state').toBe('declined');

  const after = await notifications(buyer);
  const told = after.find((n) => n.type === 'photo.declined');
  expect(told, 'the buyer is told no more photos are coming').toBeTruthy();
  expect(told.title).toBe('No more photos available');
  expect(told.link).toBe(`/property/${listing.slug || listing.id}`);

  /* A declined request must not read as resolved anywhere in the buyer's inbox either. */
  expect(after.some((n) => n.type === 'photo.added'), 'a decline is never announced as an addition').toBe(false);
});
