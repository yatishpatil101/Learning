import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Regression coverage for D97(c) and D97(a), against a real server.
 *
 * ## D97(c) — a filling room must show the disclosure strip, not hide it
 *
 * `occupancyOf` derives occupancy from the flat's committed ledger (`flatCommitted`). A room
 * with people living in it but seats still open is FILLING, and the card must show "N people
 * have taken rooms so far" rather than hiding the strip as OCCUPIED. On the live backend,
 * occupancy is server-derived — the only way to produce a FILLING room is to split a flat and
 * then record occupants via `PATCH /flatmates/rooms/{id}/occupants`.
 *
 * The mock twin seeded `occupancy: 'filling'` directly into localStorage. That tested the
 * client-side re-derivation fix (the `!== EMPTY` guard), but the live backend never stores
 * `occupancy: 'filling'` — it stores occupants, and the feed DTO carries `flatCommitted`.
 * This spec proves the whole chain: API-derived `flatCommitted > 0` on the feed card →
 * `occupancyOf` returns FILLING → `RoomCard` shows the disclosure strip.
 *
 * ## D97(a) — the reissue CTA prefills the rent-agreement wizard
 *
 * The flatmate board's "reissue the joint agreement" CTA links to
 * `/services/rent-agreement?flat=<listing-id>&reissue=1`. The wizard now reads `flat` as an
 * alias for `listing` and, when `reissue=1`, prefills the property and fires a toast. On a
 * live build `myListings` is loaded through the http provider (`GET /me/listings`), so the
 * wizard resolves the listing from the server, not from localStorage — fully live-provable.
 *
 * ## What is deliberately NOT asserted
 *
 * - D97(b) (addFlatmateRequest dropping the room `share` intent) has no rendered consumer
 *   surface — it is covered by code review, not here.
 * - The exact wording of the disclosure strip beyond a regex match. The i18n key has been
 *   stable since D97, and pinning it to an exact string would tie this spec to a copywriter's
 *   future edit.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
}

/**
 * Split a flat into one room, approve it, and record occupants.
 *
 * Follows the same pattern as `live-discovery.spec.js:splitFlat` — four calls because
 * the product needs four, each load-bearing. Then records occupants so the room enters
 * the FILLING state.
 */
const created = { mobile: null, listingId: null, roomId: null };

async function splitAndFill(occupants) {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  created.mobile = mobile;
  const adminHeaders = auth((await apiLogin(ACTORS.admin)).accessToken);

  // 1. Post a rent listing.
  const listing = await api('POST', '/me/listings', auth(accessToken), {
    deal: 'rent',
    propertyType: 'Flat',
    price: 36000,
    city: 'Pune',
    bhk: 2,
    area: 900,
    locality: 'Baner',
    title: `Zztest D97 ${Date.now()}`,
  });
  expect(listing.status, listing.text).toBe(201);
  created.listingId = listing.json.id;

  // 2. Ops approval — makes the split owner-tier.
  const approved = await api('PATCH', `/properties/${listing.json.id}/status`, adminHeaders, {
    status: 'approved',
  });
  expect(approved.status, approved.text).toBe(200);

  // 3. Split into one room with capacity 3.
  const split = await api('POST', `/properties/${listing.json.id}/split`, auth(accessToken), {
    maxOccupants: 3,
    rooms: [{ roomKind: 'master', rent: 18000, note: 'Zztest D97 room.' }],
  });
  expect(split.status, split.text).toBe(201);
  const room = split.json.rooms[0];
  created.roomId = room.id;

  // 4. Approve the room so it appears on the public board.
  const moderated = await api('PATCH', `/admin/flatmates/${room.id}/moderation`,
    auth((await apiLogin(ACTORS.admin)).accessToken), { modStatus: 'approved' });
  expect(moderated.status, moderated.text).toBe(200);

  // 5. Record occupants to produce FILLING state.
  const occ = await api('PATCH', `/flatmates/rooms/${room.id}/occupants`, auth(accessToken), {
    occupants,
  });
  expect(occ.status, occ.text).toBe(200);

  track('rooms', room.id, accessToken);
  return { mobile, listingId: listing.json.id, room: occ.json, accessToken };
}

test.afterAll(async () => {
  if (created.roomId && created.listingId) {
    const unsplit = await api('DELETE', `/properties/${created.listingId}/split`,
      auth((await apiLogin(created.mobile)).accessToken));
    // 204 on success, 409 if already unsplit, 404 if already cleaned up — all fine.
    if (unsplit.status !== 204 && unsplit.status !== 409 && unsplit.status !== 404) {
      expect(unsplit.status, `unsplit cleanup: ${unsplit.text}`).toBe(204);
    }
  }
  if (created.listingId) {
    const rejected = await api('PATCH', `/properties/${created.listingId}/status`,
      auth((await apiLogin(ACTORS.admin)).accessToken), {
        status: 'rejected',
        reason: 'Zztest cleanup — D97 fixture',
      });
    if (rejected.status !== 200 && rejected.status !== 404) {
      expect(rejected.status, `listing cleanup: ${rejected.text}`).toBe(200);
    }
  }
});

test('D97(c): a room with occupants shows the filling disclosure strip, not OCCUPIED', async ({ page }) => {
  const { mobile, room } = await splitAndFill(2);

  // Verify the server reports flatCommitted > 0 on the public feed.
  await expect
    .poll(async () => {
      const res = await fetch(`${API}/flatmates/feed?tab=move-in&size=100`);
      const body = await res.json();
      const items = body.content ?? body;
      const feedRoom = items.find((r) => r.id === room.id);
      return feedRoom?.flatCommitted ?? -1;
    }, { message: 'the server should report flatCommitted > 0 for the filled room', timeout: 15_000 })
    .toBeGreaterThan(0);

  // Browser: the disclosure strip must show the filling note, not be hidden.
  await signedInAs(page, mobile);
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });

  const card = page.locator('.sf-card', { hasText: room.society }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });

  // "N people have taken rooms so far" — the filling note. Pre-fix this strip was hidden
  // because occupancyOf collapsed 'filling' to OCCUPIED.
  await expect(card.getByText(/people have taken rooms so far/i)).toBeVisible({ timeout: 5_000 });
});

test('D97(a): the reissue CTA (?flat=<id>&reissue=1) prefills the property and confirms with a toast', async ({ page }) => {
  // The test above already split a flat and recorded occupants. Reuse the same owner.
  // If the tests run in order (workers=1), `created` is populated. Guard against empty.
  expect(created.listingId, 'splitAndFill must have run first').toBeTruthy();
  expect(created.mobile, 'splitAndFill must have run first').toBeTruthy();

  await signedInAs(page, created.mobile);

  // Navigate to the rent-agreement wizard with ?flat=<listing-id>&reissue=1.
  await page.goto(`${BASE}/services/rent-agreement?flat=${created.listingId}&reissue=1`);

  // The reissue toast fires when `flat` resolves a listing AND reissue=1.
  // (.first() because React StrictMode double-invokes the effect in dev, firing the toast twice.)
  await expect(
    page.getByRole('alert').filter({ hasText: /Reissuing the agreement/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
});
