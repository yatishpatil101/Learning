// Isolated owners prevent shared account state from affecting visibility assertions.
// Reject fixtures after each test so pending rows do not remain in the moderation queue.
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

const created = new Set();

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 27000,
  city: 'Pune',
  bhk: 2,
  area: 900,
  areaUnit: 'sqft',
  // A real entry in `GET /localities`, so the resolver files the listing rather than dropping it
  // into the curation queue another spec owns.
  locality: 'Baner',
};

// Relative storage URLs match the local provider and satisfy the image CSP.
const photos = (tag) => [
  `/api/dev/storage/public/photos/${tag}/first`,
  `/api/dev/storage/public/photos/${tag}/second`,
];

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function owner() {
  const mobile = uniqueMobile();
  return { mobile, headers: await authHeaders(mobile) };
}

// The owner route lets the server assign the initial moderation state.
async function postListing(headers, fields) {
  const res = await api('POST', '/me/listings', headers, {
    title: `Zztest owner-preview ${Date.now().toString(36)}`,
    ...BASE_LISTING,
    ...fields,
  });
  expect(res.status, 'POST /me/listings').toBe(201);
  created.add(res.body.id);
  return res.body;
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected', reason: 'Zztest cleanup',
    });
  }
  created.clear();
});

test.describe('LIVE — an owner\'s listing before it is approved', () => {
  test('the cover is the first photo when no cover was ever chosen', async () => {
    const me = await owner();
    const images = photos('cover');
    const posted = await postListing(me.headers, { images });

    // No cover field is posted: this must be derived, not echoed from the fixture.
    expect(posted.coverImage).toBe(images[0]);

    const detail = await api('GET', `/properties/${posted.id}`, me.headers);
    expect(detail.status).toBe(200);
    expect(detail.body.coverImage).toBe(images[0]);
    // The gallery is untouched: the cover is the first frame *of* it, not a replacement for it.
    expect(detail.body.images).toEqual(images);
  });

  test('a listing with no photos has no cover, rather than a broken one', async () => {
    const me = await owner();
    const posted = await postListing(me.headers, {});
    // NON_NULL serialization omits the cover so the card can select its fallback image.
    expect(posted.coverImage).toBeUndefined();
  });

  test('the dashboard card shows the photo the owner uploaded, not the placeholder', async ({ page }) => {
    const me = await owner();
    const images = photos('card');
    const posted = await postListing(me.headers, { images, title: `Zztest card ${Date.now().toString(36)}` });

    await signedInAs(page, me.mobile);
    const listingsRead = page.waitForResponse((res) =>
      new URL(res.url()).pathname === '/api/me/listings'
      && res.request().method() === 'GET'
      && res.status() === 200);
    await page.goto('/dashboard#listings');
    await listingsRead;

    // Located by its own title, because the board carries every listing this account owns and a
    // `.first()` would drift as the file grows.
    const card = page.getByRole('img', { name: posted.title });
    await expect(card).toHaveAttribute('src', images[0]);
  });

  test('availability is shown only after the dashboard listing is approved', async ({ page }) => {
    const me = await owner();
    const posted = await postListing(me.headers, {});
    expect(posted.status).toBe('pending');

    await signedInAs(page, me.mobile);
    await page.goto('/dashboard#listings');
    const card = page.getByRole('img', { name: posted.title, exact: true }).locator('../..');
    await expect(card.getByText('Under review', { exact: true })).toBeVisible();
    await expect(card.getByText('Active', { exact: true })).toHaveCount(0);
    await expect(card.getByText('Availability', { exact: true })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /^(Confirm available|Reactivate)$/ })).toHaveCount(0);

    const admin = await authHeaders(ACTORS.admin);
    const approved = await api('PATCH', `/properties/${posted.id}/status`, admin, {
      status: 'approved', reason: 'Zztest approval',
    });
    expect(approved.status).toBe(200);
    await page.reload();
    await expect(card.getByText('Live', { exact: true })).toBeVisible();
    await expect(card.getByText('Active', { exact: true })).toBeVisible();
    await expect(card.getByText('Availability', { exact: true })).toBeVisible();
  });

  test('the owner can open their own pending listing, and is told only they can see it', async ({ page }) => {
    const me = await owner();
    const posted = await postListing(me.headers, { images: photos('preview') });
    expect(posted.status, 'a new listing starts in moderation').toBe('pending');

    await signedInAs(page, me.mobile);
    await page.goto(`/property/${posted.id}`);

    // The composed heading and detail section distinguish the full preview from an interstitial.
    await expect(page.getByText(/only you can see this page/i)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /2 BHK Flat for Rent in Baner/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /key details/i })).toBeVisible();
  });

  test('a stranger is told nothing, signed in or not', async ({ page }) => {
    const me = await owner();
    const posted = await postListing(me.headers, {});

    const anonymous = await api('GET', `/properties/${posted.id}`, { 'content-type': 'application/json' });
    expect(anonymous.status, 'no viewer').toBe(404);

    const other = await owner();
    const stranger = await api('GET', `/properties/${posted.id}`, other.headers);
    expect(stranger.status, 'a different signed-in account').toBe(404);

    // Strangers must not be able to distinguish an unapproved listing from a nonexistent one.
    await page.goto(`/property/${posted.id}`);
    await expect(page.getByText(/property not found/i)).toBeVisible();
  });

  test('taking a listing down hides it from its owner too', async () => {
    const me = await owner();
    const posted = await postListing(me.headers, {});

    const archived = await api('PATCH', `/properties/${posted.id}/archive`, me.headers, { reason: 'Zztest' });
    expect(archived.status).toBe(200);

    // Withdrawing must remove access even for the owner, not silently create a private listing.
    const mine = await api('GET', `/properties/${posted.id}`, me.headers);
    expect(mine.status).toBe(404);

    // Restore so `afterEach` can reject it — a rejection on an archived row leaves it on neither
    // queue, and the next reader of this database cannot tell which state it was meant to be in.
    await api('PATCH', `/properties/${posted.id}/restore`, me.headers);
  });
});
