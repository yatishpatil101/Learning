import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * The flatmate shortlist, end to end.
 *
 * ## What this replaces, and why the replacement is stronger
 *
 * `prefreeze.spec.js` owned one claim — a saved room renders a real card on `/saved` rather than
 * the raw storage key — and its header explained that it could never be a live test:
 *
 * > Flatmate saves are localStorage-bound (`draazyFlatmateSaved` in `useFlatmates.jsx`), not
 * > backed by the API [...] There is no server endpoint to read this save back from, so there is
 * > no live assertion to make.
 *
 * That was true when it was written and is no longer. `GET/PUT/DELETE /me/flatmate-saves` now
 * exists, the shortlist belongs to a person instead of to a browser, and the save stores the key
 * alone — the card is joined on read. So the interesting claims are the two the old test could not
 * make at all:
 *
 * 1. **A save follows the person, not the device.** Asserted in a second browser context, which is
 *    what a localStorage shortlist can never satisfy. This was a real gap: a room bookmarked on a
 *    phone was simply absent on the same person's laptop.
 * 2. **The card cannot go stale.** The old key cached the title, locality, rent and photo at the
 *    moment of the tap. Here the host changes the rent after the save and the shortlist shows the
 *    new number, because there is nothing cached to disagree with.
 *
 * The original claim is kept as well — the society title, never `r:<id>` — because it is the one
 * assertion that catches the mapper being wired to the wrong field.
 *
 * ## Shape
 *
 * Rows are created over HTTP and published through real moderation, the convention the rest of this
 * folder follows: a post held by D72 is invisible for a reason that has nothing to do with saving
 * it, and conflating the two would let a moderation regression pass as a shortlist result.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function adminToken() {
  return (await apiLogin(ACTORS.admin)).accessToken;
}

/** Let a row past the D72 moderation gate, which is a different gate from the one under test. */
async function publish(id) {
  const response = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(await adminToken()),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e flatmate-saves fixture' }),
  });
  expect(response.status).toBeLessThan(300);
}

async function createRoom(token, body) {
  const response = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      bhk: '2', roomType: 'Private room', attachedBath: 'attached', furnishing: 'semi',
      locality: 'Baner', rentShare: 15000, deposit: 30000, availableFrom: '2026-12-01',
      lookingFor: 'any', foodPref: 'any', photos: ['https://cdn.example/saves.jpg'],
      ...body,
    }),
  });
  const room = await response.json();
  expect(response.status, JSON.stringify(room)).toBe(201);
  track('rooms', room.id, token);
  await publish(room.id);
  return room;
}

async function createGroup(token, body) {
  const response = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      locality: 'Baner', rent: 45000, seats: 3, seatsOpen: 1, policy: 'any', name: 'Saves Host',
      ...body,
    }),
  });
  const group = await response.json();
  expect(response.status, JSON.stringify(group)).toBe(201);
  track('groups', group.id, token);
  await publish(group.id);
  return group;
}

/** The shortlist as the server holds it — the assertion the localStorage version had no way to make. */
async function serverSaves(token) {
  const response = await fetch(`${API}/me/flatmate-saves?size=100`, { headers: auth(token) });
  const page = await response.json();
  expect(response.status, JSON.stringify(page)).toBe(200);
  return page;
}

/** Open the Flatmates board on the rooms view and wait for a card. */
async function openRooms(page) {
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 20_000 });
}

/** Open `/saved` on the flatmate category. */
async function openSavedFlatmates(page) {
  await page.goto(`${BASE}/saved`);
  const tab = page.getByRole('button', { name: /Flatmates & Rooms/i });
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
}

/** The board card for one room, found by its society name rather than by position. */
function cardFor(page, society) {
  return page.locator('.sf-card').filter({ hasText: society }).first();
}

test('a saved room reaches the Saved page as a real card, and the bookmark survives a reload', async ({ page }) => {
  const host = uniqueMobile();
  const seeker = uniqueMobile();
  const hostAuth = await apiLogin(host);
  const society = `Zztest Saves ${stamp()}`;
  await createRoom(hostAuth.accessToken, { society });

  await signedInAs(page, seeker);
  await openRooms(page);
  const card = cardFor(page, society);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.locator('.save-btn').click();
  await expect(card.locator('.save-btn')).toHaveClass(/saved/, { timeout: 10_000 });

  await openSavedFlatmates(page);
  // The society name, never the storage key — the claim `prefreeze.spec.js` existed for.
  await expect(page.getByText(society, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^r:/)).toHaveCount(0);

  // Back on the board the bookmark is still filled. It is restored from `/me/flatmate-saves/keys`
  // now, so this is a round trip rather than a re-read of the tab's own storage.
  await openRooms(page);
  await expect(cardFor(page, society).locator('.save-btn')).toHaveClass(/saved/, { timeout: 15_000 });
});

test('the shortlist belongs to the person, so it is there on a second device', async ({ page, browser }) => {
  const host = uniqueMobile();
  const seeker = uniqueMobile();
  const hostAuth = await apiLogin(host);
  const society = `Zztest Devices ${stamp()}`;
  await createRoom(hostAuth.accessToken, { society });

  await signedInAs(page, seeker);
  await openRooms(page);
  await cardFor(page, society).locator('.save-btn').click();
  await expect(cardFor(page, society).locator('.save-btn')).toHaveClass(/saved/, { timeout: 10_000 });

  /* A second context is a second device: separate storage, same person. The localStorage shortlist
     this replaced could not pass this by construction — the save lived in the first browser and the
     second one had never heard of it. */
  const second = await browser.newContext();
  try {
    const laptop = await second.newPage();
    await signedInAs(laptop, seeker);
    await openSavedFlatmates(laptop);
    await expect(laptop.getByText(society, { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    await openRooms(laptop);
    await expect(cardFor(laptop, society).locator('.save-btn')).toHaveClass(/saved/, { timeout: 15_000 });
  } finally {
    await second.close();
  }
});

test('the saved card shows what the room says today, not what it said when it was saved', async ({ page }) => {
  const host = uniqueMobile();
  const seeker = uniqueMobile();
  const hostAuth = await apiLogin(host);
  const society = `Zztest Stale ${stamp()}`;
  const room = await createRoom(hostAuth.accessToken, { society, rentShare: 15000 });

  await signedInAs(page, seeker);
  await openRooms(page);
  await cardFor(page, society).locator('.save-btn').click();
  await expect(cardFor(page, society).locator('.save-btn')).toHaveClass(/saved/, { timeout: 10_000 });

  // The host reprices after the save. The old shortlist cached the card at tap time and would have
  // gone on showing ₹15,000 for as long as the bookmark lived.
  //
  // A full body, not a sparse patch: `PATCH /flatmates/rooms/{id}` binds `FlatmateRoomCreateRequest`
  // and validates it, so sending `rentShare` alone 422s on every other required field.
  const repriced = await fetch(`${API}/flatmates/rooms/${room.id}`, {
    method: 'PATCH',
    headers: auth(hostAuth.accessToken),
    body: JSON.stringify({
      bhk: '2', roomType: 'Private room', attachedBath: 'attached', furnishing: 'semi',
      locality: 'Baner', society, rentShare: 21000, deposit: 30000, availableFrom: '2026-12-01',
      lookingFor: 'any', foodPref: 'any', photos: ['https://cdn.example/saves.jpg'],
    }),
  });
  expect(repriced.status, await repriced.clone().text()).toBeLessThan(300);
  await publish(room.id);

  await openSavedFlatmates(page);
  await expect(page.getByText(society, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/21,000/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/15,000/)).toHaveCount(0);
});

test('unsaving removes the row on the server, not just from the local list', async ({ page }) => {
  const host = uniqueMobile();
  const seeker = uniqueMobile();
  const hostAuth = await apiLogin(host);
  const seekerAuth = await apiLogin(seeker);
  const society = `Zztest Unsave ${stamp()}`;
  await createRoom(hostAuth.accessToken, { society });

  await signedInAs(page, seeker);
  await openRooms(page);
  await cardFor(page, society).locator('.save-btn').click();
  await expect(cardFor(page, society).locator('.save-btn')).toHaveClass(/saved/, { timeout: 10_000 });
  expect((await serverSaves(seekerAuth.accessToken)).totalElements).toBe(1);

  // Toggling the same bookmark off must reach the server. A local-only removal would leave the
  // shortlist intact and the card would be back on the next visit with no explanation.
  await cardFor(page, society).locator('.save-btn').click();
  await expect(cardFor(page, society).locator('.save-btn')).not.toHaveClass(/saved/, { timeout: 10_000 });
  await expect.poll(
    async () => (await serverSaves(seekerAuth.accessToken)).totalElements,
    { timeout: 10_000 },
  ).toBe(0);

  // Not via `openSavedFlatmates`: `Saved.jsx` renders the category strip only when
  // `allCards.length > 0`, so removing the last save removes the "Flatmates & Rooms" tab with it.
  // The whole-page empty state IS the assertion here - it proves the page rendered and found
  // nothing, which a bare absence check could not tell apart from a page that failed to load.
  await page.goto(`${BASE}/saved`);
  await expect(page.getByText(/No saved properties yet/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(society, { exact: false })).toHaveCount(0);
});

test('the shortlist holds rooms and groups together, newest save first', async ({ page }) => {
  const host = uniqueMobile();
  const seeker = uniqueMobile();
  const hostAuth = await apiLogin(host);
  const seekerAuth = await apiLogin(seeker);
  const society = `Zztest Mixed ${stamp()}`;
  const title = `Zztest Mixed group ${stamp()} in Baner`;
  const room = await createRoom(hostAuth.accessToken, { society });
  const group = await createGroup(hostAuth.accessToken, { title });

  await signedInAs(page, seeker);
  await openRooms(page);
  await cardFor(page, society).locator('.save-btn').click();
  await expect(cardFor(page, society).locator('.save-btn')).toHaveClass(/saved/, { timeout: 10_000 });

  await page.goto(`${BASE}/flatmates?view=groups`);
  const groupCard = page.locator('.sf-card').filter({ hasText: title }).first();
  await expect(groupCard).toBeVisible({ timeout: 20_000 });
  await groupCard.locator('.save-btn').click();
  await expect(groupCard.locator('.save-btn')).toHaveClass(/saved/, { timeout: 10_000 });

  /* Heterogeneous and ordered, asserted on the wire because the two are one claim: the shortlist
     may point at three different tables and still has to come back in one list in one order. */
  const saved = await serverSaves(seekerAuth.accessToken);
  expect(saved.totalElements).toBe(2);
  expect(saved.content.map((row) => row.id)).toEqual([group.id, room.id]);

  await openSavedFlatmates(page);
  await expect(page.getByText(society, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
});

test('saving while signed out asks for identity instead of writing a bookmark nobody owns', async ({ page }) => {
  const host = uniqueMobile();
  const hostAuth = await apiLogin(host);
  const society = `Zztest Anon ${stamp()}`;
  await createRoom(hostAuth.accessToken, { society });

  // No `signedInAs`. This is the behaviour change the shortlist forced: a bookmark used to be a
  // localStorage write, so an anonymous visitor got one that appeared to work and then vanished the
  // moment they signed in anywhere. A save is now a row owned by a person, so there is nothing
  // honest to write without one - the same call the property heart and `onInterest`/`onJoin` make.
  await openRooms(page);
  await cardFor(page, society).locator(".save-btn").click();
  await expect(page).toHaveURL(/\/signin/, { timeout: 15_000 });
});
