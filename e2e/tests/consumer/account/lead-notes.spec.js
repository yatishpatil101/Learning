import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

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

async function actor(name) {
  const base = uniqueMobile();
  const mobile = `${base.slice(0, -1)}${actorSequence++ % 10}`;
  const headers = await authHeaders(mobile);
  const named = await api('PATCH', '/auth/me', headers, { name });
  expect(named.status, `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

async function isolatedListing() {
  const owner = await actor(`Zztest Lead Notes Owner ${Date.now()}`);
  const created = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest lead notes listing ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 26000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 900,
    images: await uploadedListingPhotos(owner.headers),
  });
  expect(created.status, 'creating the isolated listing').toBe(201);
  createdListings.add(created.body.id);

  const approved = await approveListingWithFetch(created.body.id, await authHeaders(ACTORS.admin));
  expect(approved.status, 'approving the isolated listing').toBe(200);
  return { owner, id: created.body.id };
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListings) {
    const rejected = await rejectListingWithFetch(id, adminHeaders, {
      reason: 'Zztest cleanup - isolated lead notes fixture',
    });
    expect(rejected.status, `cleaning up isolated listing ${id}`).toBe(200);
  }
  createdListings.clear();
});

test('an owner note and follow-up date are stored on the server, not in the browser', async ({ page, request }) => {
  const fixture = await isolatedListing();
  const buyer = await actor(`Zztest Lead Notes Buyer ${Date.now()}`);

  const requested = await request.post(`${API}/contacts/request`, {
    headers: buyer.headers,
    data: { propertyId: fixture.id, message: 'Keen on this one, please share your number.' },
  });
  expect(requested.status()).toBe(200);

  const inbox = await api('GET', '/me/contact-requests?size=50', fixture.owner.headers);
  expect(inbox.status).toBe(200);
  const row = inbox.body.content.find((item) => item.propertyId === fixture.id);
  expect(row, 'the owner must receive the new request').toBeTruthy();
  const leadKey = `number:${row.id}`;
  /* The owner starts with no annotation at all. Asserted as the BEFORE half of the pair, because
     "the note is on the server" is not evidence of a write if every account ships with one. */

  const empty = await api('GET', '/me/lead-notes', fixture.owner.headers);
  expect(empty.status).toBe(200);
  expect(empty.body.find((n) => n.leadKey === leadKey), 'no annotation should exist yet').toBeFalsy();

  await signedInAs(page, fixture.owner.mobile);
  await page.goto('/dashboard#enquiries');

  const lead = page.locator('div.group.relative.rounded-xl').filter({ hasText: buyer.name }).first();
  await expect(lead).toBeVisible();

  await lead.getByRole('button', { name: /^Open .* details$/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet, 'the lead sheet must open before its fields can be trusted').toBeVisible();

  const savedNote = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/me/lead-notes/${encodeURIComponent(leadKey)}`
    && response.request().method() === 'PUT'
    && response.status() === 200,
  );
  await sheet.locator('#lead-note').fill('Wants to move in before Diwali. Ask about the parking slot.');
  await sheet.locator('#lead-note').blur();
  await savedNote;

  const savedDate = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/me/lead-notes/${encodeURIComponent(leadKey)}`
    && response.request().method() === 'PUT'
    && response.status() === 200,
  );
  await sheet.locator('#lead-followup').fill('2027-03-14');
  await savedDate;
  /* Read back below the UI. This is the assertion the old localStorage implementation could not
     have passed: it proves the value left the browser that typed it. */

  const stored = await api('GET', '/me/lead-notes', fixture.owner.headers);
  expect(stored.status).toBe(200);
  const annotation = stored.body.find((n) => n.leadKey === leadKey);
  expect(annotation, 'the annotation must exist server-side').toBeTruthy();
  expect(annotation.note).toContain('before Diwali');

  expect(new Date(annotation.followUpAt).getUTCFullYear()).toBe(2027);
  expect(annotation.followUpAt.startsWith('2027-03-14'), `follow-up stored as ${annotation.followUpAt}`).toBe(true);
  /* A second browser context: a different profile, a different localStorage, the same owner. This
     is the defect being fixed, stated as a test — the phone and the laptop must agree. */

  const other = await page.context().browser().newContext();
  const otherPage = await other.newPage();
  await signedInAs(otherPage, fixture.owner.mobile);
  await otherPage.goto('/dashboard#enquiries');

  const otherLead = otherPage.locator('div.group.relative.rounded-xl').filter({ hasText: buyer.name }).first();
  await expect(otherLead).toBeVisible();
  await expect(otherLead, 'the follow-up chip must render for the same owner in a fresh browser').toContainText('14 Mar');

  await otherLead.getByRole('button', { name: /^Open .* details$/ }).click();
  const otherSheet = otherPage.getByRole('dialog');
  await expect(otherSheet).toBeVisible();
  await expect(otherSheet.locator('#lead-note')).toHaveValue(/before Diwali/);

  await other.close();
});

test('clearing both fields deletes the annotation instead of storing a blank one', async ({ page, request }) => {
  const fixture = await isolatedListing();
  const buyer = await actor(`Zztest Lead Notes Clearing Buyer ${Date.now()}`);

  const requested = await request.post(`${API}/contacts/request`, {
    headers: buyer.headers,
    data: { propertyId: fixture.id, message: 'Following up on this listing.' },
  });
  expect(requested.status()).toBe(200);

  const inbox = await api('GET', '/me/contact-requests?size=50', fixture.owner.headers);
  const row = inbox.body.content.find((item) => item.propertyId === fixture.id);
  expect(row, 'the owner must receive the new request').toBeTruthy();
  const leadKey = `number:${row.id}`;

  await signedInAs(page, fixture.owner.mobile);
  await page.goto('/dashboard#enquiries');

  const lead = page.locator('div.group.relative.rounded-xl').filter({ hasText: buyer.name }).first();
  await expect(lead).toBeVisible();
  await lead.getByRole('button', { name: /^Open .* details$/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();

  const written = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/me/lead-notes/${encodeURIComponent(leadKey)}`
    && response.request().method() === 'PUT'
    && response.status() === 200,
  );
  await sheet.locator('#lead-note').fill('Temporary note that is about to be removed.');
  await sheet.locator('#lead-note').blur();
  await written;
  /* The BEFORE half. Without it, the emptiness asserted below could be the emptiness of a note
     that was never written in the first place. */

  const before = await api('GET', '/me/lead-notes', fixture.owner.headers);
  expect(before.body.find((n) => n.leadKey === leadKey), 'the note must exist before it is cleared').toBeTruthy();
  /* Emptying the last populated field is a delete, not a write of two nulls — the endpoint answers
     204 and drops the row, which is why the client treats a null result as "remove this key". */

  const cleared = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/me/lead-notes/${encodeURIComponent(leadKey)}`
    && response.request().method() === 'PUT'
    && response.status() === 204,
  );
  await sheet.locator('#lead-note').fill('');
  await sheet.locator('#lead-note').blur();
  await cleared;

  const after = await api('GET', '/me/lead-notes', fixture.owner.headers);
  expect(after.status).toBe(200);
  expect(after.body.find((n) => n.leadKey === leadKey), 'the annotation must be gone, not blank').toBeFalsy();
});
