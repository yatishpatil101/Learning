import { test, expect, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, E2E_OTP, apiLogin, authHeaders, uniqueMobile } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/* Every filter assertion runs on both feeds: `verifiedOnly` has two independent implementations
   (`FlatmateRoomRepository.feed` JPQL and `FlatmateSearchQueries` SQL) that can disagree. */

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

/* A tenant-tier approval is refused 422 unless the registration particulars are on file and the
   owner has consented — `FlatmateModerationService.requireConsentToApprove`. A precondition here. */
const REGISTERED = {
  agreementRegNo: 'PNE-3/9012/2025',
  agreementRegisteredOn: '2025-10-01',
  agreementValidTill: '2027-09-01',
};

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
  ...(agreementDeclared ? REGISTERED : {}),
  ...(ownerConsentMobile ? { ownerConsentMobile } : {}),
  ...(propertyId ? { propertyId } : {}),
});

async function postRoom(token, spec) {
  const created = await api('POST', '/flatmates/rooms', auth(token), roomBody(spec));
  expect(created.status, created.text).toBe(201);
  track('rooms', created.json.id, token);
  return created.json;
}

/** Let a room out onto the public board. The moderation axis, which grants no badge. */
async function publish(roomId) {
  const published = await api('PATCH', `/admin/flatmates/${roomId}/moderation`,
    await authHeaders(STAFF.rental), { modStatus: 'live', note: 'Zztest trust-badge fixture' });
  expect(published.status, published.text).toBe(200);
}

/** Ops decides the host-verification review this room raised. The trust axis. */
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

/** The room as a signed-out seeker reads it off `GET /flatmates/rooms`. */
async function roomsBoard(roomId, verifiedOnly = false) {
  const page = await api('GET', `/flatmates/rooms?${BAND}${verifiedOnly ? '&verifiedOnly=true' : ''}`);
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

/** Both readers of `verifiedOnly` agree about this room. The point of the whole file. */
async function expectVerifiedOnly(roomId, name, present) {
  const onRooms = await roomsBoard(roomId, true);
  const onFeed = await mixedFeed(roomId, name, true);
  expect(Boolean(onRooms), 'GET /flatmates/rooms?verifiedOnly=true').toBe(present);
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
    const { accessToken } = await apiLogin(uniqueMobile());
    const name = society('tenant badge');
    const ownerConsentMobile = await consentTo(accessToken, name);
    const spec = { society: name, hostRole: 'tenant', agreementDeclared: true, ownerConsentMobile };
    const room = await postRoom(accessToken, spec);
    await publish(room.id);

    // Before the verdict the claim is only a claim: on the board, but not behind the filter.
    expect(await roomsBoard(room.id), 'a tenant-tier room publishes on arrival').toBeTruthy();
    await expectVerifiedOnly(room.id, name, false);

    await decideReview(room.id, 'approved');
    await expectVerifiedOnly(room.id, name, true);

    const card = page.locator(`[data-sf-id="r:${room.id}"]`);
    await openBoardOn(page, name);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText(TENANT_BADGE);

    /* The edit reopens the review, because the yes was about facts it may have just changed. The
       room stays public: moderation and verification are separate axes. */
    const moved = `${name} Annexe`;
    const edited = await api('PATCH', `/flatmates/rooms/${room.id}`, auth(accessToken),
      roomBody({ ...spec, society: moved }));
    expect(edited.status, edited.text).toBe(200);

    expect(await roomsBoard(room.id), 'an edit is not a takedown').toBeTruthy();
    /* The regression this file exists for: the pill went back to Under Review while the filter,
       reading a boolean the verdict had outlived, kept serving the room as verified. */
    await expectVerifiedOnly(room.id, moved, false);

    await openBoardOn(page, moved);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).not.toContainText(TENANT_BADGE);
  });

  test('clearing a contested address is not an agreement, so it mints no badge', async ({ page }) => {
    const name = society('contested');
    const first = await apiLogin(uniqueMobile());
    await postRoom(first.accessToken, { society: name, hostRole: 'tenant', agreementDeclared: true });

    /* A second host at the same address. This one stakes no agreement, so its tier is the identity
       floor; it is queued only because two strangers now claim one flat. */
    const { accessToken } = await apiLogin(uniqueMobile());
    const contested = await postRoom(accessToken, { society: name });
    expect(contested.verificationTier).toBe('identity');
    await publish(contested.id);

    const review = await decideReview(contested.id, 'approved');
    expect(review.tier, 'the queued review is the identity floor, not a tenancy claim').toBe('identity');

    /* Ops answered "these two are not the same flat", which settles an address dispute and says
       nothing about who lives there. A badge here would be minted out of nothing. */
    const row = await roomsBoard(contested.id);
    expect(row, 'the cleared room is public').toBeTruthy();
    expect(row.verificationTier).toBe('identity');
    await expectVerifiedOnly(contested.id, name, false);

    await openBoardOn(page, name);
    const card = page.locator(`[data-sf-id="r:${contested.id}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).not.toContainText(TENANT_BADGE);
    await expect(card).not.toContainText(OWNER_BADGE);
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
      // A real entry in `GET /localities`, so the row is filed rather than queued for curation.
      locality: 'Baner',
      title: `Zztest owner spare room ${Date.now()}`,
    });
    expect(listing.status, listing.text).toBe(201);
    const listingId = listing.json.id;
    const approved = await api('PATCH', `/properties/${listingId}/status`,
      await authHeaders(ACTORS.admin), { status: 'approved' });
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
    await expect(card).toContainText(OWNER_BADGE);

    /* The id is checked, not trusted. Every seeker knows a listing id — it is in the URL of the
       listing's own page — so naming one must not be enough to inherit its owner's badge. */
    const stranger = await apiLogin(uniqueMobile());
    const borrowed = await postRoom(stranger.accessToken, {
      society: society('borrowed id'), hostRole: 'owner', propertyId: listingId,
    });
    expect(borrowed.verificationTier).toBe('identity');
    expect(borrowed.verified).toBe(false);

    const rejected = await api('PATCH', `/properties/${listingId}/status`,
      await authHeaders(ACTORS.admin), {
        status: 'rejected',
        reason: 'Zztest cleanup — synthetic owner-tier flatmate fixture',
      });
    expect(rejected.status, rejected.text).toBe(200);
  });

  test('pulling the listing takes the owner badge back, once Ops runs the pass', async ({ page }) => {
    const { accessToken } = await apiLogin(uniqueMobile());
    const name = society('owner revoked');

    const listing = await api('POST', '/me/listings', auth(accessToken), {
      deal: 'rent',
      propertyType: 'Flat',
      price: 44000,
      city: 'Pune',
      bhk: 2,
      area: 950,
      locality: 'Baner',
      title: `Zztest owner tier revoked ${Date.now()}`,
    });
    expect(listing.status, listing.text).toBe(201);
    const listingId = listing.json.id;
    const approved = await api('PATCH', `/properties/${listingId}/status`,
      await authHeaders(ACTORS.admin), { status: 'approved' });
    expect(approved.status, approved.text).toBe(200);

    const room = await postRoom(accessToken, {
      society: name, hostRole: 'owner', propertyId: listingId,
    });
    expect(room.verificationTier).toBe('owner');
    await expectVerifiedOnly(room.id, name, true);

    /* The tier is derived only on a host-initiated write and owner tier never enters the queue, so
       the reconcile pass below is the only lever that takes a pulled listing's badge back. */
    const pulled = await api('PATCH', `/properties/${listingId}/status`,
      await authHeaders(ACTORS.admin), {
        status: 'rejected',
        reason: 'Zztest — ownership could not be substantiated',
      });
    expect(pulled.status, pulled.text).toBe(200);

    const staff = await authHeaders(STAFF.rental);
    const swept = await api('POST', '/admin/flatmate-reviews/reconcile-owner-tier', staff);
    expect(swept.status, swept.text).toBe(200);
    expect(swept.json.demoted, 'the pulled listing s room is demoted').toBeGreaterThanOrEqual(1);

    const row = await roomsBoard(room.id);
    expect(row, 'a demotion is not a takedown — the room is still public').toBeTruthy();
    expect(row.verificationTier, 'this host staked no agreement, so it falls to the floor')
      .toBe('identity');
    await expectVerifiedOnly(room.id, name, false);

    await openBoardOn(page, name);
    const card = page.locator(`[data-sf-id="r:${room.id}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).not.toContainText(OWNER_BADGE);

    /* Idempotent. It re-asks a question rather than applying a delta, so the second person working
       the queue finds this room already settled instead of demoting it a rung further. */
    const again = await api('POST', '/admin/flatmate-reviews/reconcile-owner-tier', staff);
    expect(again.status, again.text).toBe(200);
    expect((await roomsBoard(room.id)).verificationTier).toBe('identity');
  });

  test('a host cannot run the owner-tier pass over everybody else s posts', async () => {
    const { accessToken } = await apiLogin(uniqueMobile());
    const refused = await api('POST', '/admin/flatmate-reviews/reconcile-owner-tier', auth(accessToken));
    expect(refused.status, refused.text).toBe(403);
  });
});
