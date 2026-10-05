// Admin → Properties → **Re-check Queue** (Q14) against the live API.
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';
import { appReady } from '../../helpers/app.js';
import { approveListing, rejectListing } from '../../helpers/moderation.js';

const admin = () => authHeaders(ACTORS.admin);

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 26000,
  city: 'Pune',
  bhk: 2,
  area: 780,
  // A real row in `GET /localities`, so the listing is filed rather than dropped into the curation
  // queue that `locality-queue` owns.
  locality: 'Baner',
};

const NEW_PRICE = 31000;
const REJECT_REASON = 'Re-check failed \u2014 the price does not match the documents';

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// Every listing this file adds to the shared catalogue, drained by `afterEach`.
const created = new Set();

async function queuedRecheck(request, tag) {
  const title = `Zztest recheck ${tag} ${String(Date.now()).slice(-7)}`;
  const ownerMobile = uniqueMobile();
  const owner = await authHeaders(ownerMobile);

  const posted = await api('POST', '/me/listings', owner, { ...BASE_LISTING, title, images: await uploadedListingPhotos(owner) });
  expect(posted.status, 'the owner could not post a listing').toBe(201);
  const id = posted.body.id;
  created.add(id);

  const approved = await approveListing(request, id, await admin());
  expect(approved.status(), 'the listing could not be approved').toBe(200);

  const edited = await api('PATCH', `/me/listings/${id}`, owner, { price: NEW_PRICE });
  expect(edited.status, 'the owner could not change the price').toBe(200);

  const mine = await api('GET', `/me/listings/${id}`, owner);
  expect(mine.body.recheckPending, 'the server did not queue a re-check for a price change').toBe(true);
  expect(mine.body.recheckReason).toBe('price');
  expect(mine.body.status, 'a re-check must not take the listing off search').toBe('approved');

  return { id, title, ownerMobile, owner };
}

test.afterEach(async ({ request }) => {
  if (!created.size) return;
  const headers = await admin();
  for (const id of created) {
    await rejectListing(request, id, headers, {
      reasonCode: 'other',
      reason: 'Zztest cleanup \u2014 synthetic re-check fixture',
    });
  }
  created.clear();
});

// `listForModeration` fetches `size=100` and reports through `console.error` when the catalogue is larger than that.
const CATALOGUE_TRUNCATED = /^\[property\] \d+ listings matched but only \d+ were fetched/;
const realErrors = (errors) => errors.filter((e) => !CATALOGUE_TRUNCATED.test(e));

const tab = (page, name) => page.getByRole('tab', { name });
const cardFor = (page, title) => page.getByTestId('queue-row').filter({ hasText: title });

// The search is not decoration.
async function openQueue(page, login, title) {
  // The strip distinguishes unreviewed price changes from ordinary approved rows.
  await login.asAdmin();
  await page.goto('/admin/properties?tab=recheck');
  await appReady(page);
  await expect(tab(page, /^Re-checks/)).toHaveAttribute('aria-selected', 'true');
  if (title) {
    await page.getByPlaceholder('Title, owner, mobile or ID').first().fill(title);
    await expect(cardFor(page, title)).toBeVisible({ timeout: 20000 });
  }
}

test('the queue holds the row the product put there, and names what changed', async ({ page, login, consoleErrors, request }) => {
  const seeded = await queuedRecheck(request, 'visible');
  await openQueue(page, login, seeded.title);

  await expect(page.getByTestId('recheck-note')).toContainText('They stay in search until you check them');

  const card = cardFor(page, seeded.title);
  await expect(card.getByTestId('recheck-fields')).toHaveText('price');

  await expect(card.getByTestId('recheck-age')).toHaveText(/^waiting \d+m$/);
  await expect(card.getByTestId('recheck-age')).not.toHaveText('waiting \u2014 no timestamp');

  expect(realErrors(consoleErrors)).toHaveLength(0);
});

test('the tab count is the server\u2019s own count of the queue', async ({ page, login, request }) => {
  const seeded = await queuedRecheck(request, 'counted');

  // Read the queue's size from the endpoint the tab is derived from, rather than pinning a number.
  const queue = await api('GET', '/admin/properties?recheck=true&size=1', await admin());
  expect(queue.status).toBe(200);
  expect(queue.body.totalElements, 'the seeded row is not in the server queue').toBeGreaterThanOrEqual(1);

  await openQueue(page, login, seeded.title);

  await expect(page.getByTestId('tab-count-recheck')).toHaveText(String(queue.body.totalElements));
});

test('the listing really is still live while it waits', async ({ page, login, request }) => {
  const seeded = await queuedRecheck(request, 'stays-live');

  // Public anonymous reads must still show the changed price in the catalogue.
  const publicView = await fetch(`${API}/properties/${seeded.id}`);
  expect(publicView.status, 'a re-checked listing must stay on the public site').toBe(200);
  expect((await publicView.json()).price).toBe(NEW_PRICE);

  await login.asAdmin();
  await page.goto('/admin/properties?tab=all');
  await appReady(page);
  await expect(tab(page, /^All listings/)).toHaveAttribute('aria-selected', 'true');
  await page.getByPlaceholder('Title, owner, mobile or ID').first().fill(seeded.title);
  await expect(cardFor(page, seeded.title)).toBeVisible({ timeout: 20000 });
  await expect(cardFor(page, seeded.title).getByTestId('recheck-strip')).toBeVisible();
});

test('passing a re-check clears it on the server and leaves the listing earning', async ({ page, login, request }) => {
  page.on('dialog', (d) => d.accept());
  const seeded = await queuedRecheck(request, 'pass');
  await openQueue(page, login, seeded.title);

  await cardFor(page, seeded.title).getByTestId('recheck-pass').click();
  await expect(cardFor(page, seeded.title)).toHaveCount(0);
  await expect(page.getByText('No listings match these filters.')).toBeVisible();

  // Read back over the *owner's* token, from a different process than the one that clicked.
  const mine = await api('GET', `/me/listings/${seeded.id}`, seeded.owner);
  expect(mine.body.status, 'checked-it-all-fine must not take the listing down').toBe('approved');
  expect(mine.body.recheckPending).toBe(false);
  expect((await fetch(`${API}/properties/${seeded.id}`)).status).toBe(200);
});

test('failing a re-check takes the listing down, and tells the owner why', async ({ page, login, request }) => {
  const seeded = await queuedRecheck(request, 'fail');
  await openQueue(page, login, seeded.title);

  await cardFor(page, seeded.title).getByTestId('recheck-fail').click();
  // The dialog stays open rather than closing on a decision it did not take.
  await expect(page.getByRole('heading', { name: /Re-check failed/i })).toBeVisible();
  await page.getByRole('button', { name: 'Wrong details' }).click();
  await page.getByPlaceholder(/One clear fix/).fill(REJECT_REASON);
  await page.getByRole('button', { name: /Reject listing/i }).click();
  await expect(cardFor(page, seeded.title)).toHaveCount(0);

  // And nothing moved on the server.
  const mine = await api('GET', `/me/listings/${seeded.id}`, seeded.owner);
  expect(mine.body.status).toBe('rejected');
  expect(mine.body.recheckPending).toBe(false);
  // Off the public site — the other half of "taken down", and the half a status field cannot prove.
  expect((await fetch(`${API}/properties/${seeded.id}`)).status).not.toBe(200);

  // The reason, where the owner reads it.
  const thread = await api('GET', `/properties/${seeded.id}/verification`, seeded.owner);
  expect(thread.status, 'the owner cannot open the thread the decision was written into').toBe(200);
  expect(JSON.stringify(thread.body)).toContain(REJECT_REASON);
});

test('a rejection with no reason is refused, and the listing survives it', async ({ page, login, request }) => {
  const seeded = await queuedRecheck(request, 'no-reason');
  await openQueue(page, login, seeded.title);

  await cardFor(page, seeded.title).getByTestId('recheck-fail').click();
  await expect(page.getByRole('heading', { name: /Re-check failed/i })).toBeVisible();
  await page.getByRole('button', { name: /Reject listing/i }).click();

  await expect(page.getByRole('heading', { name: /Re-check failed/i })).toBeVisible();

  const mine = await api('GET', `/me/listings/${seeded.id}`, seeded.owner);
  expect(mine.body.status).toBe('approved');
  expect(mine.body.recheckPending).toBe(true);
  expect((await fetch(`${API}/properties/${seeded.id}`)).status).toBe(200);
});

async function uploadOwnershipDocument(owner, id) {
  const form = new FormData();
  form.set('file', new Blob(['%PDF-1.4 index ii'], { type: 'application/pdf' }), 'index-ii.pdf');
  form.set('category', 'Index II');
  const res = await fetch(`${API}/me/documents/${id}`, { method: 'POST', headers: { authorization: owner.authorization }, body: form });
  expect(res.status, 'the owner could not upload an ownership document').toBe(201);
}

test('an upload alone queues nothing; the vault request does, and staff can decline it with a reason', async ({ page, login, consoleErrors, request }) => {
  const title = `Zztest badge ${String(Date.now()).slice(-7)}`;
  const owner = await authHeaders(uniqueMobile());
  const posted = await api('POST', '/me/listings', owner, { ...BASE_LISTING, title, images: await uploadedListingPhotos(owner) });
  expect(posted.status).toBe(201);
  const { id } = posted.body;
  created.add(id);
  expect((await approveListing(request, id, await admin())).status()).toBe(200);

  await uploadOwnershipDocument(owner, id);
  const uploaded = await api('GET', `/me/listings/${id}`, owner);
  expect(uploaded.body.recheckPending, 'filing a paper in the vault is not a badge request').toBe(false);
  expect(uploaded.body.ownershipRequestedAt ?? null).toBeNull();

  const asked = await api('POST', `/properties/${id}/verification/ownership/request`, owner);
  expect(asked.status).toBe(200);
  const mine = await api('GET', `/me/listings/${id}`, owner);
  expect(mine.body.status, 'a badge request must not take the listing off search').toBe('approved');
  expect(mine.body.recheckPending, 'the request did not reach the staff queue').toBe(true);
  expect(mine.body.recheckReason).toBe('Ownership documents');
  expect(mine.body.ownershipRequestedAt).toBeTruthy();

  await login.asAdmin();
  await page.goto('/admin/properties?tab=badge');
  await appReady(page);
  await expect(tab(page, /^Badge requests/)).toHaveAttribute('aria-selected', 'true');
  await page.getByPlaceholder('Title, owner, mobile or ID').first().fill(title);
  const card = cardFor(page, title);
  await expect(card.getByTestId('recheck-strip')).toContainText('Badge request:');
  await expect(card.getByTestId('recheck-pass')).toHaveCount(0);
  await expect(card.getByTestId('recheck-fail')).toHaveCount(0);

  await card.getByTestId('review-badge-request').click();
  await expect(page.getByTestId('badge-request-banner')).toContainText('Owner is seeking the Verified property badge');
  await expect(page.getByText('Ownership document checks')).toBeVisible();

  const reason = 'The Index II is for a different flat';
  await page.getByTestId('decline-badge-request').click();
  await expect(page.getByTestId('confirm-badge-decline')).toBeDisabled();
  await page.getByTestId('badge-decline-reason').fill(reason);
  await page.getByTestId('confirm-badge-decline').click();
  await expect(cardFor(page, title)).toHaveCount(0);

  const after = await api('GET', `/me/listings/${id}`, owner);
  expect(after.body.status).toBe('approved');
  expect(after.body.recheckPending).toBe(false);
  expect(after.body.ownershipRequestedAt ?? null).toBeNull();
  expect(after.body.ownershipDeclinedReason).toBe(reason);

  const inbox = await api('GET', '/notifications?size=50', owner);
  const told = inbox.body.content.find((n) => n.type === 'listing.badge_declined');
  expect(told, 'the owner is told the badge was not granted').toBeTruthy();
  expect(told.body).toBe(reason);
  expect(realErrors(consoleErrors)).toHaveLength(0);
});
