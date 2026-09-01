import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { trackErrors } from '../../../helpers/console.js';

/**
 * The two demand-side interest doors, driven from the board against a real server.
 *
 * `live-interactions.spec.js` owns the routes behind them, and owns them well — nine tests over
 * `POST /flatmates/rooms/{id}/interest` and `POST /flatmates/groups/{id}/join`, including both 409s
 * told apart by sub-code, the shared budget, the outbox and the withdraw. Not one of them opens a
 * page: every test there destructures `{ page }` and never uses it. So the buttons that reach those
 * routes, and everything the page does with the answers, had no live test at all. This file is that
 * half, and nothing else — where a claim is already pinned at the contract level it is left there.
 *
 * ## Four claims of the mock twin are deliberately NOT converted, because live they cannot happen
 *
 * `interest-api.spec.js` has a family of "second device" tests: clear this browser's storage, tap
 * again, and be told by a 409 that the ask already exists. They were possible because in mock mode
 * the sent-state came from a localStorage map of *this browser's* taps — so wiping it genuinely
 * offered the action a second time.
 *
 * Live it does not. `useFlatmates` (the `interests` effect) reads the CTA's state from the server
 * outbox, `GET /me/flatmate-interests`, whenever the signed-in identity changes; its own comment
 * names the bug it was fixing — "a second device offered a duplicate action until the API rejected
 * it". A second device therefore comes up already showing "Interest sent", the button is not there
 * to press, and the duplicate 409 is unreachable through the UI. Verified rather than assumed: each
 * of those four tests was written against the live server first, and each timed out waiting for a
 * CTA that no longer appears.
 *
 * So the conversion inverts them. Instead of four tests that a duplicate tap is handled kindly,
 * there are two that the duplicate is never offered — which is the stronger statement, and the one
 * the product now makes. The 409 keeps its coverage in `live-interactions.spec.js`, where it
 * belongs, since it is reachable only by a client that is not this UI.
 *
 * Dropped with them, for the same reason, is the mock's D183 pair about what a *second* device
 * writes to `pnPendingRequests` on a 409. The hand-off is still asserted here — test 2 — but on the
 * success path, which is the only path a browser can now take. It stays a localStorage claim
 * because Messages is still a localStorage reader; when Messages grows a server-side inbox the two
 * move together (D183).
 *
 * ## The tone assertions are structural on purpose
 *
 * A refused join must read as an error and a successful ask must not. Both are asserted on the
 * toast container's own class (`rose`, the error variant) rather than on the words, because the
 * words are the thing an edit is most likely to change and they cannot tell a calm message from an
 * alarming one anyway.
 */

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

/* Unique per test, and unique on two axes at once. The board is one shared list reset per run
   rather than per file, so a fixed name would let one test's fixture answer another's locator; and
   `FlatmateGuardrails` keys address dedupe on society+locality, so a fixed society would get the
   second room in this file flagged as a duplicate listing. */
const uniqueSociety = (tag) => `Live Doors ${tag} ${Date.now().toString(36)}`;

/**
 * A room somebody else hosts, on the public board.
 *
 * `society` is what the enquiry toast names, so it carries one — the mapper reads `row.society` and
 * falls back to the empty string, which would make every toast assertion here read "the owner of .".
 * `photos` is `@NotEmpty` because a room with no pictures is the shape broker spam takes.
 */
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
    }),
  });
  const body = await res.text();
  expect(res.status, body).toBe(201);
  const room = JSON.parse(body);
  track('rooms', room.id, token);
  await approve(room.id);
  return room;
}

/** A group somebody else hosts, with seats open. `seats`, not `seatsTotal` — the response renames
 *  it and the request does not accept the renamed form. `policy: 'any'` makes it an open group, so
 *  a join is a join rather than a request, which is the door carrying the `group_full` sub-code. */
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

/* What the host was actually sent, by the name the seeker would recognise. This is the live
   successor of the mock's ledger assertion (`pnMockFlatmateInterests` contains a composite key):
   the row exists because the door reached the server, and it is the row the feature exists to
   create, rather than a store the provider keeps for itself. */
async function hostInboxTitles(token) {
  const res = await fetch(`${API}/me/flatmate-requests?size=100`, { headers: auth(token) });
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.content ?? body.items ?? body).map((r) => r.targetTitle);
}

const toast = (page) => page.getByRole('alert').last();
const isErrorToast = async (page) => ((await toast(page).getAttribute('class')) || '').includes('rose');

/**
 * A second device: the same person, signed in, holding none of the state this browser accrued.
 *
 * Every key dropped here is written by the page rather than by the provider, so the server's record
 * of the ask survives untouched — which is exactly the asymmetry tests 3 and 4 are about. A reload
 * on its own would not do: the sent state is persisted on purpose.
 */
async function forgetDevice(page) {
  await page.evaluate(() => {
    ['puneNestFlatmateInterests', 'pnPendingRequests']
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.reload();
}

const queuedFor = (page, propertyId) => page.evaluate(
  (id) => JSON.parse(localStorage.getItem('pnPendingRequests') || '[]').filter((r) => r?.propertyId === id),
  propertyId,
);

/* The card flips OPTIMISTICALLY — `setInterests` runs before the request is sent, deliberately, so
 * that a second tap has no button to land on. `rememberAsk` only writes after the await resolves.
 * So "Interest sent" on screen is not proof the device has recorded anything, and a `forgetDevice`
 * fired on that signal races the write: the removal lands first, the write lands second, and the
 * device comes back still remembering. Wait for the durable write instead. */
const rememberedAsk = (page, key) => expect.poll(
  () => page.evaluate(
    (k) => Object.values(JSON.parse(localStorage.getItem('puneNestFlatmateInterests') || '{}')).some((m) => m?.[k]),
    key,
  ),
  { message: `the device should have recorded ${key} locally`, timeout: 15_000 },
).toBe(true);

/* Open the inbox on the tab a fresh ask actually lands on. A handed-off request arrives
   `state: 'pending'`, and Messages files anything pending under Requests — Chats is only
   `state: 'active'`, i.e. threads the other side has already answered. */
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

/** The groups board. */
async function openTeamUp(page) {
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Team up/ }).first().click();
}

const cardFor = (page, text) => page.locator('.sf-card', { hasText: text }).first();

test.describe('Flatmate interest doors (live)', () => {
  test('a first room enquiry reaches the server, and the card flips to sent', async ({ page }) => {
    const errors = trackErrors(page);
    const host = await newHost();
    const society = uniqueSociety('first');
    await hostsRoom(host.accessToken, society);
    await signedInAsNew(page);

    await openRooms(page);
    const card = cardFor(page, society);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: /Message owner/i }).click();

    await expect(page.getByText(`Message sent to the owner of ${society}.`)).toBeVisible({ timeout: 10_000 });
    expect(await isErrorToast(page), 'a successful enquiry must not render as an error').toBe(false);
    await expect(card.getByRole('button', { name: /Interest sent/i })).toBeVisible();

    /* The half the mock could not assert. The card flipping is the page agreeing with itself; the
       host holding a row is the door having been opened. Take the `flatmateService.roomInterest(...)`
       call out and the toast and the flip both still happen — only this line reds. */
    expect(await hostInboxTitles(host.accessToken), 'the host should be holding the enquiry')
      .toContain(society);
    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('the enquiry hands off to Messages, so the sent card has somewhere to point', async ({ page }) => {
    const host = await newHost();
    const society = uniqueSociety('handoff');
    const room = await hostsRoom(host.accessToken, society);
    await signedInAsNew(page);

    await openRooms(page);
    await expect(cardFor(page, society)).toBeVisible({ timeout: 15_000 });
    await cardFor(page, society).getByRole('button', { name: /Message owner/i }).click();
    await expect(page.getByText(`Message sent to the owner of ${society}.`)).toBeVisible({ timeout: 10_000 });

    /* The toast says "Continue in Messages", and this is whether it can be. `recordAskLocally` is
       the only thing that puts it there — drop it from the success branch of `onRoomInterest` and
       the card still flips, the host still has the row, and the seeker arrives in Messages to
       nothing. D183: the queue is localStorage because Messages is, and the pair moves together. */
    expect(await queuedFor(page, `room-${room.id}`), 'the ask should be queued for Messages').toHaveLength(1);

    /* A second assertion stood here: that the same ask was "announced in the bell", read back out
       of a `puneNestNotifications` array. It was proving a write nobody reads — the live inbox is
       `GET /notifications` and never looked at that key, so the bell badge and the Notifications
       page could not have shown the row the test was finding. The client no longer mints it.

       And it arrives as something the seeker can see, not just a row in storage. The mock twin went
       further and asserted the queue was drained into `pnConversations` on mount — that is not
       converted, because it was never a claim about this feature: it is the mock conversation
       provider's own bookkeeping, and `conversation` is a live domain here, so Messages reads the
       server and leaves the queue alone. */
    await openInboxRequests(page);
    await expect(page.getByText(`Room in ${society}`).first()).toBeVisible({ timeout: 15_000 });
  });

  test('the sent state follows the seeker to a second device, so the duplicate is never offered', async ({ page }) => {
    const host = await newHost();
    const society = uniqueSociety('device');
    const room = await hostsRoom(host.accessToken, society);
    await signedInAsNew(page);

    await openRooms(page);
    await expect(cardFor(page, society)).toBeVisible({ timeout: 15_000 });
    await cardFor(page, society).getByRole('button', { name: /Message owner/i }).click();
    await expect(cardFor(page, society).getByRole('button', { name: /Interest sent/i })).toBeVisible({ timeout: 10_000 });

    await rememberedAsk(page, `room-${room.id}`);
    await forgetDevice(page);
    /* Precondition, and what makes the assertion below mean anything: this device really is starting
       from nothing. If the reload ever leaked the old map across, the test would be vacuous. */
    expect(await page.evaluate(() => localStorage.getItem('puneNestFlatmateInterests')), 'the device must have forgotten').toBeNull();

    /* THE assertion, and the reason four of the mock twin's tests are not here. Point the
       `interests` effect back at `getAskedInterests(user.mobile)` — the localStorage map it used to
       read — and this device comes up offering "Message owner" for an enquiry the owner already
       holds: a duplicate the seeker is invited to make and the server then refuses. */
    const card = cardFor(page, society);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('button', { name: /Interest sent/i })).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('button', { name: /Message owner/i })).toHaveCount(0);
  });

  test('a join is remembered the same way, on a device that never made it', async ({ page }) => {
    const host = await newHost();
    const title = `Live doors join ${Date.now().toString(36)} in Baner`;
    const group = await hostsGroup(host.accessToken, title, { seats: 3, seatsOpen: 2 });
    await signedInAsNew(page);

    await openTeamUp(page);
    await expect(cardFor(page, title)).toBeVisible({ timeout: 15_000 });
    await cardFor(page, title).getByRole('button', { name: /Join group/i }).click();
    await expect(cardFor(page, title).getByRole('button', { name: /^Joined$/ })).toBeVisible({ timeout: 10_000 });

    await rememberedAsk(page, `group-${group.id}`);
    await forgetDevice(page);
    await page.getByRole('button', { name: /Team up/ }).first().click();

    /* The sibling door, pinned separately rather than left to the room test to imply: the two share
       one outbox read (`interestKey` prefixes the id with the kind), so they diverge the moment that
       key is wrong for one of them — which is the shape of every contract-drift bug this feature has
       already produced. */
    const card = cardFor(page, title);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('button', { name: /^Joined$/ })).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('button', { name: /Join group/i })).toHaveCount(0);
  });

  test('a group that fills behind the board answers group_full, not already-asked', async ({ page }) => {
    const host = await newHost();
    const title = `Live doors full ${Date.now().toString(36)} in Baner`;
    const group = await hostsGroup(host.accessToken, title, { seats: 2, seatsOpen: 1 });
    await signedInAsNew(page);

    await openTeamUp(page);
    const card = cardFor(page, title);
    await expect(card).toBeVisible({ timeout: 15_000 });
    const join = card.getByRole('button', { name: /Join group/i });
    await join.waitFor({ state: 'visible', timeout: 15_000 });

    /* Take the last seat behind the page, over the route only the host can call. The board is a
       snapshot, so the button is still offered — which is the race `group_full` exists for, and the
       reason a client-side seat pre-check would be worse than useless: it would answer from the
       same stale data instead of asking. */
    expect((await setSeats(host.accessToken, group.id, 0)).status).toBeLessThan(300);

    await join.click();

    await expect(page.getByText(`${title} is already full.`)).toBeVisible({ timeout: 10_000 });
    expect(await isErrorToast(page), 'a refused join is a real error and should look like one').toBe(true);
    // Not the other 409 on the same door, and not the generic fallback.
    await expect(page.getByText(/already has your earlier request/i)).toHaveCount(0);

    /* Rolled back AND corrected. Rollback alone would restore a live "Join group" on a card still
       claiming a free seat, so the only move left would be to tap again and be refused again — the
       409 is the one authoritative word that the snapshot is stale, so it is spent on refreshing it.
       Delete the `await refresh()` from that branch and this pair is what reds. */
    await expect(card.getByRole('button', { name: /^Join group$/i })).toHaveCount(0, { timeout: 10_000 });
    await expect(card.getByText(/full/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('an ordinary failure rolls the card back instead of leaving it claiming success', async ({ page }) => {
    const host = await newHost();
    const title = `Live doors gone ${Date.now().toString(36)} in Baner`;
    const group = await hostsGroup(host.accessToken, title, { seats: 2, seatsOpen: 1 });
    await signedInAsNew(page);

    await openTeamUp(page);
    const card = cardFor(page, title);
    await expect(card).toBeVisible({ timeout: 15_000 });
    const join = card.getByRole('button', { name: /Join group/i });
    await join.waitFor({ state: 'visible', timeout: 15_000 });

    /* Withdraw the group behind the page, so the door answers a plain 404 — neither 409, so it lands
       on the generic branch. That branch is the one an optimistic UI gets wrong: without its
       rollback the card sits in a done state for an ask that never happened, and no other test here
       would say so, because every other one either succeeds or is refused by name. */
    const del = await fetch(`${API}/flatmates/groups/${group.id}`, {
      method: 'DELETE', headers: auth(host.accessToken),
    });
    expect(del.status).toBeLessThan(300);

    await join.click();

    expect(await isErrorToast(page), 'a real failure must read as one').toBe(true);
    await expect(card.getByRole('button', { name: /^(Joined|Requested)$/ })).toHaveCount(0);
  });

  test("the next person to sign in on a shared browser does not inherit the first one's asks", async ({ page }) => {
    const host = await newHost();
    const society = uniqueSociety('shared');
    await hostsRoom(host.accessToken, society);

    await signedInAsNew(page);
    await openRooms(page);
    await expect(cardFor(page, society)).toBeVisible({ timeout: 15_000 });
    await cardFor(page, society).getByRole('button', { name: /Message owner/i }).click();
    await expect(cardFor(page, society).getByRole('button', { name: /Interest sent/i })).toBeVisible({ timeout: 10_000 });

    /* A second person, on the same browser, without clearing anything. The outbox the CTA reads is
       keyed to whoever is signed in — and the test above is precisely the reason this one has to
       exist, because the same effect that carries a person's asks to their other phone would carry
       them to the next person at this desk if it were keyed to the device instead. B would be shown
       that this owner had already been contacted, have no button to press, and the server would
       never be asked at all. */
    await signedInAsNew(page);
    await openRooms(page);
    const card = cardFor(page, society);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('button', { name: /Message owner/i })).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole('button', { name: /Interest sent/i })).toHaveCount(0);
  });
});
