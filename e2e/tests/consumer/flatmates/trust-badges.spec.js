import { test, expect, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, E2E_OTP, apiLogin, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';
import { withSocietyId } from '../../../helpers/liveSociety.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const track = flatmateCleanup(test);

const OWNER_BADGE = 'Owner-verified';
const TENANT_BADGE = 'Tenant-verified';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}
/* `GET /flatmates/rooms` takes no free-text parameter, so a fixture has to be found by a facet;
   rent is the only one that can be made arbitrary without lying about the room. */

const RENT = 48777;
const BAND = 'minBudget=48000&maxBudget=49500&size=100';
/** A society name unique to one test, so the mixed feed's `q` finds exactly one room. */
const society = (label) => `Zztest ${label} ${Date.now().toString(36)}`;
/* Both OTP legs are the only way the flag is set — `FlatmateMapper` drops a client-supplied
   `ownerConsent`. V30 keys the consent on the society, so it must match the room's address. */
async function consentTo(token, name) {
  const ownerMobile = uniqueMobile(); // never the host's own — the server refuses self-consent
  for (const payload of [{ ownerMobile, society: name, locality: 'Baner' },
    { ownerMobile, society: name, locality: 'Baner', otp: E2E_OTP }]) {
    const sent = await api('POST', '/flatmates/owner-consent', auth(token), payload);
    expect(sent.status, sent.text).toBe(200);
  }
  return ownerMobile;
}
/* `PATCH /flatmates/rooms/{id}` takes the POST schema rather than a sparse patch, so an edit must
   resend everything it is not changing or validation fails on `photos`. */

const roomBody = ({ society: name, hostRole = 'tenant', agreementDeclared = false, propertyId, ownerConsentMobile }) => ({
  bhk: '2',
  roomType: 'Private room',
  attachedBath: 'attached',
  furnishing: 'semi',
  locality: 'Baner',
  society: name,
  rentShare: RENT,
  deposit: 90000,
  availableFrom: '2026-12-01',
  lookingFor: 'any',
  foodPref: 'any',
  photos: ['https://cdn.example/zztest-trust-badge.jpg'],
  hostRole,
  agreementDeclared,
  ...(ownerConsentMobile ? { ownerConsentMobile } : {}),
  ...(propertyId ? { propertyId } : {}),
});

async function roomPayload(token, spec) {
  const body = await withSocietyId(token, roomBody(spec));
  return (body.hostRole || 'tenant') === 'tenant'
    ? { ...body, ...(await tenantRoomAgreement(token)), ...(body.ownerConsentMobile ? { ownerConsentMobile: body.ownerConsentMobile } : {}) }
    : body;
}

async function postRoom(token, spec) {
  const payload = await roomPayload(token, spec);
  const created = await api('POST', '/flatmates/rooms', auth(token), payload);
  expect(created.status, created.text).toBe(201);
  track('rooms', created.json.id, token);
  return created.json;
}

async function publish(roomId) {
  const published = await api('PATCH', `/admin/flatmates/${roomId}/moderation`,
    await authHeaders(STAFF.rental), { modStatus: 'live', note: 'Zztest trust-badge fixture' });
  expect(published.status, published.text).toBe(200);
}

async function decideReview(roomId, decision) {
  const staff = await authHeaders(STAFF.rental);
  const queue = await api('GET', '/admin/flatmate-reviews?status=pending&size=200', staff);
  expect(queue.status, queue.text).toBe(200);
  const review = (queue.json.content || []).find((row) => row.roomId === roomId);
  expect(review, `room ${roomId} should be waiting in the verification queue`).toBeTruthy();

  const decided = await api('PATCH', `/admin/flatmate-reviews/${review.id}`, staff, { decision });
  expect(decided.status, decided.text).toBe(200);
  return review;
}

async function feedRoom(roomId, verifiedOnly = false) {
  const page = await api('GET', `/flatmates/feed?tab=move-in&${BAND}${verifiedOnly ? '&verifiedOnly=true' : ''}`);
  expect(page.status, page.text).toBe(200);
  return (page.json.content || []).find((row) => row.id === roomId) || null;
}
/** The same room off the mixed `GET /flatmates/feed`, which is a different query entirely. */
async function mixedFeed(roomId, name, verifiedOnly = false) {
  const query = `tab=move-in&q=${encodeURIComponent(name)}&size=100`;
  const page = await api('GET', `/flatmates/feed?${query}${verifiedOnly ? '&verifiedOnly=true' : ''}`);
  expect(page.status, page.text).toBe(200);
  return (page.json.content || []).find((row) => row.id === roomId) || null;
}

async function expectVerifiedOnly(roomId, name, present) {
  const onFeed = await mixedFeed(roomId, name, true);
  expect(Boolean(onFeed), 'GET /flatmates/feed?verifiedOnly=true').toBe(present);
}
/** The board, narrowed to one society, with the lazy route resolved rather than merely requested. */
async function openBoardOn(page, name) {
  await page.goto(`${BASE}/flatmates`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Move in now/i }).first())
    .toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder(/^Try:/).fill(name);
}

test.describe('Flatmate trust badges (live)', () => {
  test('an approved tenant claim badges the card, and editing the post takes the badge and the filter with it', async ({ page }) => {
    /* A second host at the same address. This one stakes no agreement, so its tier is the identity
       floor; it is queued only because two strangers now claim one flat. */
    const { accessToken } = await apiLogin(uniqueMobile());
    const name = society('tenant badge');
    const ownerConsentMobile = await consentTo(accessToken, name);
    const spec = { society: name, hostRole: 'tenant', agreementDeclared: true,
      ownerConsentMobile, ownerConsent: true };
    const room = await postRoom(accessToken, spec);
    await publish(room.id);

    expect(await feedRoom(room.id), 'Ops published it').toBeTruthy();
    await expectVerifiedOnly(room.id, name, false);

    await decideReview(room.id, 'approved');
    await expectVerifiedOnly(room.id, name, true);

    const card = page.locator(`[data-sf-id="r:${room.id}"]`);
    await openBoardOn(page, name);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('img', { name: TENANT_BADGE, exact: true })).toBeVisible();
    // The edit reopens the review, because the yes was about facts it may have just changed.
    const moved = `${name} Annexe`;
    const edited = await api('PATCH', `/flatmates/rooms/${room.id}`, auth(accessToken),
      await roomPayload(accessToken, { ...spec, society: moved }));
    expect(edited.status, edited.text).toBe(200);

    expect(await feedRoom(room.id), 'an edit is not a takedown').toBeTruthy();
    await expectVerifiedOnly(room.id, moved, false);

    await openBoardOn(page, moved);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('img', { name: TENANT_BADGE, exact: true })).toHaveCount(0);
  });

  test('clearing a contested address is not an agreement, so it mints no badge', async ({ page }) => {
    const name = society('contested');
    const first = await apiLogin(uniqueMobile());
    await postRoom(first.accessToken, { society: name, hostRole: 'tenant',
      agreementDeclared: true, ownerConsent: true });

    const { accessToken } = await apiLogin(uniqueMobile());
    const contested = await postRoom(accessToken, { society: name, hostRole: 'owner' });
    expect(contested.verificationTier).toBe('identity');
    await publish(contested.id);

    const review = await decideReview(contested.id, 'approved');
    expect(review.tier, 'the queued review is the identity floor, not a tenancy claim').toBe('identity');

    const row = await feedRoom(contested.id);
    expect(row, 'the cleared room is public').toBeTruthy();
    expect(row.verificationTier).toBe('identity');
    await expectVerifiedOnly(contested.id, name, false);

    await openBoardOn(page, name);
    const card = page.locator(`[data-sf-id="r:${contested.id}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('img', { name: TENANT_BADGE, exact: true })).toHaveCount(0);
    await expect(card.getByRole('img', { name: OWNER_BADGE, exact: true })).toHaveCount(0);
  });

  test('an owner letting a spare room in their own approved flat is badged without waiting for a queue', async ({ page }) => {
    const { accessToken } = await apiLogin(uniqueMobile());
    const name = society('owner spare');

    const listing = await api('POST', '/me/listings', auth(accessToken), {
      deal: 'rent',
      propertyType: 'Flat',
      price: 42000,
      city: 'Pune',
      bhk: 2,
      area: 900,
      locality: 'Baner',
      title: `Zztest owner spare room ${Date.now()}`,
      images: await uploadedListingPhotos(accessToken),
    });
    expect(listing.status, listing.text).toBe(201);
    const listingId = listing.json.id;
    const approved = await approveListingWithFetch(listingId, await authHeaders(ACTORS.admin));
    expect(approved.status, approved.text).toBe(200);

    const room = await postRoom(accessToken, {
      society: name, hostRole: 'owner', propertyId: listingId,
    });
    /* Owner tier is proof the platform already holds, so the post is live and badged on arrival.
       Without the property reference the same host falls to the identity floor. */

    expect(room.verificationTier).toBe('owner');
    expect(room.verified).toBe(true);
    expect(room.modStatus).toBe('live');
    await expectVerifiedOnly(room.id, name, true);

    await openBoardOn(page, name);
    const card = page.locator(`[data-sf-id="r:${room.id}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('img', { name: OWNER_BADGE, exact: true })).toBeVisible();
    /* The id is checked, not trusted. Every seeker knows a listing id — it is in the URL of the
       listing's own page — so naming one must not be enough to inherit its owner's badge. */
    const stranger = await apiLogin(uniqueMobile());
    const borrowed = await postRoom(stranger.accessToken, {
      society: society('borrowed id'), hostRole: 'owner', propertyId: listingId,
    });
    expect(borrowed.verificationTier).toBe('identity');
    expect(borrowed.verified).toBe(false);

    const rejected = await rejectListingWithFetch(listingId, await authHeaders(ACTORS.admin), {
      reason: 'Zztest cleanup — synthetic owner-tier flatmate fixture',
    });
    expect(rejected.status, rejected.text).toBe(200);
  });
});
