import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS, STAFF } from '../../../fixtures/live.js';

/**
 * An owner letting one flat room by room — the **owner-facing** half, against the real server.
 *
 * ## Why this file could not be written before today
 *
 * `owner-split.spec.js` carried a header stating that none of its fourteen claims could go live,
 * and it was right about the code as it stood. `MyListingsPanel` called `lib/data/flatSplit.js`'s
 * `splitFlat()` directly and `ListingCard` read `isFlatSplit` / `roomsForProperty` /
 * `splitOccupants` from `draazyRoomListings` — this browser's own localStorage, which no server
 * has ever written to. The seam exported `splitProperty` and `unsplitProperty`, and **no screen
 * imported either one**.
 *
 * So the dashboard and the API were two databases that happened to render similar words. An owner
 * who split their flat through the product got rooms in localStorage and nothing on the server:
 * their own card said "2 rooms listed" and no seeker anywhere could see a room. An owner whose
 * rooms genuinely existed server-side — via `POST /properties/{id}/split`, which is what
 * `live-discovery` drives — got a card that said nothing had happened at all.
 *
 * Both screens now read the split through the seam (`myFlatmateRooms`, grouped by `propertyId`),
 * so this file exists. It is the browser half of a rule whose server half is already owned by
 * `FlatSplitAndConsentEndpointsTest`; where that class owns a claim outright it is cited rather
 * than re-proved, because a Playwright run is a slow way to re-assert a validator.
 *
 * ## What is here, and what is deliberately not
 *
 * | claim | home |
 * |---|---|
 * | the action exists only on a rent listing | here (browser) + `ownerAndRentOnly()` |
 * | a split writes real rooms the seeker board can see | here |
 * | the card reports "N rooms listed" / "Whole-flat listing still live" | here |
 * | a split flat cannot be split again | here (the menu withdraws the action) |
 * | a split room from an approved parent is owner-verified | here |
 * | withdrawing is offered while empty, and performs a real unsplit | here |
 * | withdrawing is refused once someone has moved in | here + `unsplitRefusedWhenOccupied()` |
 * | room count bounded by BHK; occupancy cap bounded; siblings clamp | `FlatSplitAndConsentEndpointsTest` |
 * | a non-owner cannot split | `ownerAndRentOnly()` |
 *
 * Two of the mock file's claims died with it rather than moving. "Promotes the rooms once the flat
 * is approved later" described `reconcileSplitVerification`, a client-side sweep that ran in the
 * owner's browser on their next visit; the server has no equivalent callback, so an approval that
 * lands after a split leaves the rooms unbadged. That is a real product gap and is recorded in
 * `tasks/todo.md` rather than asserted here — a test that pinned the current behaviour would be
 * pinning the bug. And "stays public / hides from public search" reached into `mockApi.js`
 * directly; the visible consequence of that rule is the card chip this file does assert.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function api(method, path, headers, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* a 204 has no body */ }
  return { status: response.status, text, json };
}

/**
 * Everything created, so teardown can run even when a step throws.
 *
 * These listings are approved and public for the length of the test. A `beforeAll`-style bail-out
 * that lost the id would leave one standing on the live board for the rest of the run, which is the
 * failure mode `live-discovery` documents; the ledger is filled in step by step for the same reason.
 */
const created = [];

/**
 * One owner with one approved rent listing — the precondition for every test below.
 *
 * Approved, not pending: `FlatSplitService` decides the rooms' tier from the parent's status, and an
 * approved parent is what makes them owner-verified. A pending parent would make the badge test
 * assert the absence of a badge for the wrong reason.
 *
 * Baner and a `Zztest` title, per the convention the sibling live specs use: a real locality so the
 * row is filed rather than sent to the curation queue, and a name that marks it as synthetic.
 */
async function ownerWithFlat({ deal = 'rent', bhk = 3, price = 36000 } = {}) {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);

  const listing = await api('POST', '/me/listings', auth(accessToken), {
    deal,
    propertyType: 'Flat',
    price,
    city: 'Pune',
    bhk,
    area: 1100,
    locality: 'Baner',
    title: `Zztest owner split ${Date.now().toString(36)}`,
  });
  expect(listing.status, listing.text).toBe(201);

  const approved = await api('PATCH', `/properties/${listing.json.id}/status`,
    await authHeaders(ACTORS.admin), { status: 'approved' });
  expect(approved.status, approved.text).toBe(200);

  const record = { mobile, accessToken, listingId: listing.json.id, split: false };
  created.push(record);
  return record;
}

/** `PATCH /admin/flatmates/{id}/moderation` — D72 is a separate gate from the split itself. */
async function publishRoom(id) {
  const published = await api('PATCH', `/admin/flatmates/${id}/moderation`,
    await authHeaders(STAFF.rental), { modStatus: 'approved' });
  expect(published.status, published.text).toBe(200);
}

/**
 * Withdraw everything, in the order the server permits.
 *
 * Occupied rooms are emptied first: `unsplit` is refused while anyone lives there, and one test
 * exists precisely to prove that — so without this step the flat it built would be permanent.
 */
test.afterAll(async () => {
  for (const flat of created) {
    if (flat.split) {
      const rooms = await api('GET', '/me/flatmate-rooms?size=100', auth(flat.accessToken));
      for (const room of rooms.json?.content || rooms.json?.items || []) {
        if (Number(room.occupants) > 0) {
          await api('PATCH', `/flatmates/rooms/${room.id}/occupants`,
            auth(flat.accessToken), { occupants: 0 });
        }
      }
      await api('DELETE', `/properties/${flat.listingId}/split`, auth(flat.accessToken));
    }
    await api('PATCH', `/properties/${flat.listingId}/status`, await authHeaders(ACTORS.admin),
      { status: 'rejected', reason: 'Zztest cleanup — synthetic owner-split fixture' });
  }
});

/* ─── Browser helpers ───────────────────────────────────────────────────────────────────────── */

async function openMyProperties(page, title) {
  await page.goto(`${BASE}/dashboard`);
  const tab = page.getByRole('button', { name: /My Properties/i }).first();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

/* On a phone the dashboard's section list is a bottom sheet (`MobileNav`, a fixed `z-[1500]`
   overlay). Picking a section unmounts it, but a card *behind* it already reports `visible` while
   it is still on screen - so a click aimed at the card's overflow lands on the sheet instead, and
   Playwright reports "subtree intercepts pointer events" rather than anything about the sheet.
   Desktop never renders it, so this waits on nothing there. */
const openOverflow = async (page) => {
  await expect(page.getByRole('dialog', { name: /Choose dashboard section/i }))
    .toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('button', { name: /More/i }).first().click();
};

/**
 * Drive the split modal to completion for `want` rooms.
 *
 * The modal pre-seeds one room per bedroom and keeps confirm disabled until every room is priced,
 * so a partial fill would silently never submit — the room set is trimmed or extended first, then
 * every row is given a rent. Lifted from the mock spec this file replaces, because the modal itself
 * did not change: what changed is where its confirm handler sends the result.
 */
async function splitInto(page, want) {
  await openOverflow(page);
  await page.getByText('Let room by room').click();
  await expect(page.getByText('Let this flat room by room')).toBeVisible();

  const modal = page.locator('.sf-modal');
  const rentOf = (i) => modal.locator('input[inputmode="numeric"]').nth(i * 2);

  let shown = await modal.getByRole('button', { name: /Remove this room/ }).count();
  if (shown === 0) shown = 1; // a single room has no remove control
  while (shown > want) {
    await modal.getByRole('button', { name: /Remove this room/ }).last().click();
    shown -= 1;
  }
  while (shown < want) {
    await modal.getByRole('button', { name: /Add a room/ }).click();
    shown += 1;
  }
  for (let i = 0; i < want; i += 1) await rentOf(i).fill(String(15000 - i * 2000));

  const confirm = modal.getByRole('button', { name: /List \d+ rooms?/ });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(modal).toBeHidden();
}

/* ─── Tests ─────────────────────────────────────────────────────────────────────────────────── */

test('a sale listing is never offered the split', async ({ page }) => {
  const flat = await ownerWithFlat({ deal: 'buy', price: 9_000_000 });
  await signedInAs(page, flat.mobile);
  await openMyProperties(page, 'Zztest owner split');

  /* A flat being sold cannot be let room by room, so the action is withdrawn rather than offered
     and refused. Asserted through the menu because that is the only place an owner can reach it —
     the mock twin called `canSplitIntoRooms` in the page's own module scope, which proves the
     predicate and not the product. */
  await openOverflow(page);
  await expect(page.getByText('Let room by room')).toHaveCount(0);
});

test('splitting from the dashboard writes rooms the server can see, and the card says so', async ({ page }) => {
  const flat = await ownerWithFlat();
  await signedInAs(page, flat.mobile);
  await openMyProperties(page, 'Zztest owner split');
  await splitInto(page, 2);
  flat.split = true;

  // The card is the owner's only report that the split happened at all.
  await expect(page.getByText(/2 rooms listed/).first()).toBeVisible({ timeout: 15_000 });
  // While the flat is empty it can still honestly be let whole, so the whole-flat listing stays.
  await expect(page.getByText('Whole-flat listing still live').first()).toBeVisible();

  /* The claim the mock could not make: the rooms exist on the server, attached to this property,
     priced per room. Read on a connection the page is not holding — a card rendering from its own
     optimistic state would satisfy the assertions above and fail this one. */
  const mine = await api('GET', '/me/flatmate-rooms?size=100', auth(flat.accessToken));
  expect(mine.status, mine.text).toBe(200);
  const rows = (mine.json.content || mine.json.items || [])
    .filter((r) => String(r.propertyId) === String(flat.listingId));
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.priceBasis === 'room')).toBe(true);
  expect(rows.every((r) => Number(r.occupants) === 0)).toBe(true);
  expect(rows.map((r) => r.budget).sort((a, b) => a - b)).toEqual([13000, 15000]);
});

test('a split flat is not offered a second split, and can be withdrawn while empty', async ({ page }) => {
  const flat = await ownerWithFlat();
  await signedInAs(page, flat.mobile);
  await openMyProperties(page, 'Zztest owner split');
  await splitInto(page, 2);
  flat.split = true;
  await expect(page.getByText(/2 rooms listed/).first()).toBeVisible({ timeout: 15_000 });

  /* Splitting twice would put two room sets on one propertyId and corrupt the occupancy ledger, so
     the menu swaps the action rather than offering one the server will refuse with 409. */
  await openOverflow(page);
  await expect(page.getByText('Let room by room')).toHaveCount(0);
  const stop = page.getByText('Stop letting room by room');
  await expect(stop).toBeVisible();

  await stop.click();
  await expect(page.getByText(/2 rooms listed/)).toHaveCount(0, { timeout: 15_000 });
  flat.split = false;

  // ...and the withdrawal reached the server, not just the chip.
  const mine = await api('GET', '/me/flatmate-rooms?size=100', auth(flat.accessToken));
  const rows = (mine.json.content || mine.json.items || [])
    .filter((r) => String(r.propertyId) === String(flat.listingId));
  expect(rows).toHaveLength(0);
});

test('rooms split from an approved flat carry the owner badge on the public board', async ({ page }) => {
  const flat = await ownerWithFlat();
  await signedInAs(page, flat.mobile);
  await openMyProperties(page, 'Zztest owner split');
  await splitInto(page, 1);
  flat.split = true;
  await expect(page.getByText(/1 room listed/).first()).toBeVisible({ timeout: 15_000 });

  const mine = await api('GET', '/me/flatmate-rooms?size=100', auth(flat.accessToken));
  const room = (mine.json.content || mine.json.items || [])
    .find((r) => String(r.propertyId) === String(flat.listingId));
  expect(room, 'the split must have produced a room').toBeTruthy();

  /* The badge is the whole point of splitting a listing rather than posting a room: the flat was
     already proven, so the rooms in it are too. Decided by the server from the parent's status —
     `verificationTier` is not a field any client sends. */
  expect(room.verificationTier).toBe('owner');
  expect(room.verified).toBe(true);

  // And a seeker sees it, which is where the badge does its work.
  await publishRoom(room.id);
  await page.goto(`${BASE}/flatmates?view=rooms`);
  const card = page.locator(`[data-sf-id="r:${room.id}"]`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(/Owner[- ]verified/i).first()).toBeVisible();
});

test('once someone moves in the flat cannot be withdrawn, and the card explains the disappearance', async ({ page }) => {
  const flat = await ownerWithFlat();
  await signedInAs(page, flat.mobile);
  await openMyProperties(page, 'Zztest owner split');
  await splitInto(page, 2);
  flat.split = true;
  await expect(page.getByText(/2 rooms listed/).first()).toBeVisible({ timeout: 15_000 });

  const mine = await api('GET', '/me/flatmate-rooms?size=100', auth(flat.accessToken));
  const room = (mine.json.content || mine.json.items || [])
    .find((r) => String(r.propertyId) === String(flat.listingId));
  const moved = await api('PATCH', `/flatmates/rooms/${room.id}/occupants`,
    auth(flat.accessToken), { occupants: 1 });
  expect(moved.status, moved.text).toBe(200);

  await page.reload();
  await openMyProperties(page, 'Zztest owner split');

  /* A silent disappearance reads as a bug: the flat can no longer be let whole, so it comes off
     public search, and the card states the cause rather than leaving the owner to notice. */
  await expect(page.getByText(/1 moved in · whole-flat listing hidden/i).first())
    .toBeVisible({ timeout: 20_000 });

  // Deleting those rooms would erase a live tenancy, so the action is gone — not merely refused.
  await openOverflow(page);
  await expect(page.getByText('Stop letting room by room')).toHaveCount(0);
});
