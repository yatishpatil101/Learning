import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function adminToken() {
  return (await apiLogin(ACTORS.admin)).accessToken;
}

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
      ...(await tenantRoomAgreement(token)),
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

async function openRooms(page) {
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 20_000 });
}

async function openSavedFlatmates(page) {
  await page.goto(`${BASE}/saved`);
  const tab = page.getByRole('button', { name: /^Rooms\b/ });
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
}

function cardFor(page, society) {
  return page.locator('.sf-card').filter({ hasText: society }).first();
}

test('the board saves with the same heart the listings cards use, a saved room reaches the Saved page as a real card, and the bookmark survives a reload', async ({ page }) => {
  test.slow();
  const host = uniqueMobile();
  const seeker = uniqueMobile();
  const hostAuth = await apiLogin(host);
  const society = `Zztest Saves ${stamp()}`;
  await createRoom(hostAuth.accessToken, { society });

  await signedInAs(page, seeker);

  await test.step('the board saves with the same heart the listings cards use', async () => {
    await page.goto(`${BASE}/listings?deal=rent`);
    const listingsHeart = page.locator('.heart-btn svg').first();
    await expect(listingsHeart).toBeVisible({ timeout: 20_000 });
    const heartMarkup = await listingsHeart.innerHTML();

    await openRooms(page);
    const save = cardFor(page, society).locator('.save-btn');
    await expect(save).toBeVisible({ timeout: 20_000 });
    expect(await save.locator('svg').innerHTML()).toBe(heartMarkup);
  });

  await test.step('a saved room reaches the Saved page as a real card, and the bookmark survives a reload', async () => {
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
});
test('the shortlist belongs to the person, so it is there on a second device', async ({ page, browser }) => {
  const host = uniqueMobile();
  const seeker = uniqueMobile();
  const hostAuth = await apiLogin(host);
  const society = `Zztest Devices ${stamp()}`;
  await createRoom(hostAuth.accessToken, { society });

  await signedInAs(page, seeker);
  await openRooms(page);
  // Toggling the same bookmark off must reach the server. A local-only removal would leave the
  // shortlist intact and the card would be back on the next visit with no explanation.
  await cardFor(page, society).locator('.save-btn').click();
  await expect(cardFor(page, society).locator('.save-btn')).toHaveClass(/saved/, { timeout: 10_000 });

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

  const repriced = await fetch(`${API}/flatmates/rooms/${room.id}`, {
    method: 'PATCH',
    headers: auth(hostAuth.accessToken),
    body: JSON.stringify({
      bhk: '2', roomType: 'Private room', attachedBath: 'attached', furnishing: 'semi',
      locality: 'Baner', society, rentShare: 21000, deposit: 30000, availableFrom: '2026-12-01',
      lookingFor: 'any', foodPref: 'any', photos: ['https://cdn.example/saves.jpg'],
      ...(await tenantRoomAgreement(hostAuth.accessToken)),
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
  // Toggling the same bookmark off must reach the server.
  await cardFor(page, society).locator('.save-btn').click();
  await expect(cardFor(page, society).locator('.save-btn')).not.toHaveClass(/saved/, { timeout: 10_000 });
  await expect.poll(
    async () => (await serverSaves(seekerAuth.accessToken)).totalElements,
    { timeout: 10_000 },
  ).toBe(0);

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

  await openRooms(page);
  await cardFor(page, society).locator(".save-btn").click();
  await expect(page).toHaveURL(/\/signin/, { timeout: 15_000 });
});
