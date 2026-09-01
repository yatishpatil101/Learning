import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

/**
 * Owner-private lead notes, against the real API.
 *
 * These two fields — a free-text note and a follow-up date — used to live in
 * `localStorage` under `draazyLeadNotes:<ownerDigits>`, which meant they were per-browser: an
 * owner who took a note on their phone opened the laptop to an empty CRM. No spec could catch
 * that, because a single browser context is exactly the one place where the old storage looked
 * correct.
 *
 * So a reload-and-still-there assertion would prove nothing here — `localStorage` survives a
 * reload too, and this spec would have passed identically before the move. The load-bearing
 * assertions are the two that read the value back from a place the writing browser does not own:
 * the API read below, and the second browser context at the end.
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
  });
  expect(created.status, 'creating the isolated listing').toBe(201);
  createdListings.add(created.body.id);

  const approved = await api('PATCH', `/properties/${created.body.id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(approved.status, 'approving the isolated listing').toBe(200);
  return { owner, id: created.body.id };
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListings) {
    const rejected = await api('PATCH', `/properties/${id}/status`, adminHeaders, {
      status: 'rejected',
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

  /* Positive anchor before anything else. Every assertion that follows is scoped to a dialog that
     only exists if this row rendered, and a dialog-scoped assertion reports nothing at all when
     the dialog never opens. */
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

  /* The sheet emits the follow-up date as epoch milliseconds, while the server field is an
     `Instant` — which Jackson reads a bare number into as epoch *seconds*, landing the value some
     fifty thousand years out. The service's range guard rejects that with a 400, so the failure
     mode is a date that silently never saves rather than a corrupt row. Pinning the calendar year
     is what makes the client-side conversion a covered one: with it removed, the PUT above never
     reaches 200. */
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
