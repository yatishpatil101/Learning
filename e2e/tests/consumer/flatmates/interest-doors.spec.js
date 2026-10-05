import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { trackErrors } from '../../../helpers/console.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);
/** Let a room or a group out of moderation, the way Ops does. Both resources share the route, and
 *  both are born `pending` — the public board the seeker reads cannot see them until this runs. */
async function approve(id) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status).toBeLessThan(300);
}
/** A host who exists only on the API side — nothing here needs their browser. */
async function newHost() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

const uniqueSociety = (tag) => `Live Doors ${tag} ${Date.now().toString(36)}`;

async function hostsRoom(token, society) {
  const res = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      society,
      roomType: 'Private room',
      locality: 'Baner',
      rentShare: 18000,
      bhk: '2',
      attachedBath: 'attached',
      furnishing: 'semi',
      hostRole: 'tenant',
      photos: ['https://example.test/room.jpg'],
      ...(await tenantRoomAgreement(token)),
    }),
  });
  const body = await res.text();
  expect(res.status, body).toBe(201);
  const room = JSON.parse(body);
  track('rooms', room.id, token);
  await approve(room.id);
  return room;
}
// Open groups join immediately, so this path carries the group_full sub-code.
async function hostsGroup(token, title, { seats = 2, seatsOpen = 1 } = {}) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      title, name: 'Door Host', locality: 'Baner', rent: 30000, seats, seatsOpen,
      policy: 'any', role: 'tenant',
    }),
  });
  const body = await res.text();
  expect(res.status, body).toBe(201);
  const group = JSON.parse(body);
  track('groups', group.id, token);
  await approve(group.id);
  return group;
}
/** Move a seat behind the page — the only route that can. */
const setSeats = (token, groupId, seatsOpen) =>
  fetch(`${API}/flatmates/groups/${groupId}/seats`, {
    method: 'PATCH',
    headers: auth(token),
    body: JSON.stringify({ seatsOpen }),
  });

async function hostInboxTitles(token) {
  const res = await fetch(`${API}/me/flatmate-requests?size=100`, { headers: auth(token) });
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.content ?? body.items ?? body).map((r) => r.targetTitle);
}

const toast = (page) => page.getByRole('alert').last();
const isErrorToast = async (page) => ((await toast(page).getAttribute('class')) || '').includes('rose');

async function forgetDevice(page) {
  await page.evaluate(() => {
    ['draazyFlatmateInterests', 'dzPendingRequests']
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.reload();
}

const queuedFor = (page, propertyId) => page.evaluate(
  (id) => JSON.parse(localStorage.getItem('dzPendingRequests') || '[]').filter((r) => r?.propertyId === id),
  propertyId,
);

const rememberedAsk = (page, key) => expect.poll(
  () => page.evaluate(
    (k) => Object.values(JSON.parse(localStorage.getItem('draazyFlatmateInterests') || '{}')).some((m) => m?.[k]),
    key,
  ),
  { message: `the device should have recorded ${key} locally`, timeout: 15_000 },
).toBe(true);

const openInboxRequests = async (page) => {
  await page.goto(`${BASE}/messages`);
  await page.getByRole('tab', { name: /Requests/i }).click();
};
/** The rooms board. A room created a moment ago is on the public feed only once `approve` has run,
 *  and the board fetches on mount, so this is always a fresh navigation rather than a tab click. */
async function openRooms(page) {
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
}

async function openDetail(page, kind, id) {
  await page.goto(`${BASE}/flatmates/${kind}/${id}`);
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
}

const door = (page, name) => page.getByRole('button', { name }).filter({ visible: true });
const doneState = (page) => page.getByText(/^\s*(You're in|Requested)\s*$/).filter({ visible: true });

test.describe('Flatmate interest doors (live)', () => {
  test('a room enquiry reaches the server, hands off to Messages and follows the seeker to a second device; a join does the same', async ({ page }) => {
    test.slow();
    const errors = trackErrors(page);
    const host = await newHost();
    const society = uniqueSociety('first');
    const room = await hostsRoom(host.accessToken, society);
    await signedInAsNew(page);

    await test.step('a first room enquiry reaches the server, and the door flips to sent', async () => {
      await openRooms(page);
      const card = page.locator(`[data-sf-id="r:${room.id}"]`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.getByRole('button', { name: /Send interest/i }), 'tiles carry no actions').toHaveCount(0);
      await card.locator('h3 a').click();
      await expect(page).toHaveURL(new RegExp(`/flatmates/room/${room.id}$`));
      await door(page, /Send interest/i).first().click();

      await expect(page.getByText(`Interest sent to the owner of ${society}.`)).toBeVisible({ timeout: 10_000 });
      expect(await isErrorToast(page), 'a successful enquiry must not render as an error').toBe(false);
      await expect(door(page, /Interest sent/i).first()).toBeVisible();
      // The half the mock could not assert.
      expect(await hostInboxTitles(host.accessToken), 'the host should be holding the enquiry')
        .toContain(society);
      expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
    });

    await test.step('the enquiry hands off to Messages, so the sent door has somewhere to point', async () => {
      expect(await queuedFor(page, `room-${room.id}`), 'the ask should be queued for Messages').toHaveLength(1);

      await openInboxRequests(page);
      await expect(page.getByText(`Room in ${society}`).first()).toBeVisible({ timeout: 15_000 });
    });

    await test.step('the sent state follows the seeker to a second device, so the duplicate is never offered', async () => {
      await openDetail(page, 'room', room.id);
      await expect(door(page, /Interest sent/i).first()).toBeVisible({ timeout: 10_000 });

      await rememberedAsk(page, `room-${room.id}`);
      await forgetDevice(page);
      expect(await page.evaluate(() => localStorage.getItem('draazyFlatmateInterests')), 'the device must have forgotten').toBeNull();

      await expect(door(page, /Interest sent/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(door(page, /Send interest/i)).toHaveCount(0);
    });

    await test.step('a join is remembered the same way, on a device that never made it', async () => {
      const title = `Live doors join ${Date.now().toString(36)} in Baner`;
      const group = await hostsGroup(host.accessToken, title, { seats: 3, seatsOpen: 2 });

      await openDetail(page, 'group', group.id);
      await door(page, /Join group/i).first().click();
      await expect(doneState(page).first()).toBeVisible({ timeout: 10_000 });

      await rememberedAsk(page, `group-${group.id}`);
      await forgetDevice(page);

      await expect(doneState(page).first()).toBeVisible({ timeout: 15_000 });
      await expect(door(page, /Join group/i)).toHaveCount(0);
    });
  });
  test('a group that fills behind the page answers group_full, not already-asked', async ({ page }) => {
    const host = await newHost();
    const title = `Live doors full ${Date.now().toString(36)} in Baner`;
    const group = await hostsGroup(host.accessToken, title, { seats: 2, seatsOpen: 1 });
    await signedInAsNew(page);

    await openDetail(page, 'group', group.id);
    const join = door(page, /Join group/i).first();
    await join.waitFor({ state: 'visible', timeout: 15_000 });

    expect((await setSeats(host.accessToken, group.id, 0)).status).toBeLessThan(300);

    await join.click();

    await expect(page.getByText(`${title} is already full.`)).toBeVisible({ timeout: 10_000 });
    expect(await isErrorToast(page), 'a refused join is a real error and should look like one').toBe(true);
    // Not the other 409 on the same door, and not the generic fallback.
    await expect(page.getByText(/already has your earlier request/i)).toHaveCount(0);

    await expect(door(page, /^Join group$/i)).toHaveCount(0, { timeout: 10_000 });
    await expect(door(page, /Group full/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('an ordinary failure rolls the door back instead of leaving it claiming success', async ({ page }) => {
    const host = await newHost();
    const title = `Live doors gone ${Date.now().toString(36)} in Baner`;
    const group = await hostsGroup(host.accessToken, title, { seats: 2, seatsOpen: 1 });
    await signedInAsNew(page);

    await openDetail(page, 'group', group.id);
    const join = door(page, /Join group/i).first();
    await join.waitFor({ state: 'visible', timeout: 15_000 });

    const del = await fetch(`${API}/flatmates/groups/${group.id}`, {
      method: 'DELETE', headers: auth(host.accessToken),
    });
    expect(del.status).toBeLessThan(300);

    await join.click();

    expect(await isErrorToast(page), 'a real failure must read as one').toBe(true);
    await expect(doneState(page)).toHaveCount(0);
  });

  test("the next person to sign in on a shared browser does not inherit the first one's asks", async ({ page }) => {
    const host = await newHost();
    const society = uniqueSociety('shared');
    const room = await hostsRoom(host.accessToken, society);

    await signedInAsNew(page);
    await openDetail(page, 'room', room.id);
    await door(page, /Send interest/i).first().click();
    await expect(door(page, /Interest sent/i).first()).toBeVisible({ timeout: 10_000 });

    await signedInAsNew(page);
    await openDetail(page, 'room', room.id);
    await expect(door(page, /Send interest/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(door(page, /Interest sent/i)).toHaveCount(0);
  });

  test('once the host accepts, the room offers "Message owner" and it opens a real chat both sides share', async ({ page }) => {
    const host = await newHost();
    const society = uniqueSociety('accepted');
    const room = await hostsRoom(host.accessToken, society);
    await signedInAsNew(page);

    await openDetail(page, 'room', room.id);
    await door(page, /Send interest/i).first().click();
    await expect(door(page, /Interest sent/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('room-chat-owner')).toHaveCount(0);

    const inbox = await (await fetch(`${API}/me/flatmate-requests?size=100`, { headers: auth(host.accessToken) })).json();
    const request = (inbox.content ?? inbox.items ?? inbox).find((r) => r.targetTitle === society);
    const decided = await fetch(`${API}/me/flatmate-requests/${request.id}`, {
      method: 'PATCH',
      headers: auth(host.accessToken),
      body: JSON.stringify({ decision: 'accepted' }),
    });
    expect(decided.status).toBeLessThan(300);

    await openDetail(page, 'room', room.id);
    await page.getByTestId('room-chat-owner').filter({ visible: true }).first().click({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/messages\?c=/, { timeout: 15_000 });
    const input = page.locator('.pc-input');
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'View listing' })).toHaveCount(0);
    await expect(page.getByText('Photos coming soon')).toHaveCount(0);
    await input.fill('Can I see the room on Saturday?');
    await input.press('Enter');
    await expect(page.locator('.pc-bubble.me').last()).toContainText('Can I see the room on Saturday?');

    const threadId = new URL(page.url()).searchParams.get('c');
    const hostSide = await (await fetch(`${API}/messages/flatmate-requests/${request.id}`, { method: 'POST', headers: auth(host.accessToken), body: '{}' })).json();
    expect(hostSide.id, 'the host must land in the same thread').toBe(threadId);
  });
});
