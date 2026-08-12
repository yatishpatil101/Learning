import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* D181 — the three flatmate interest doors now go through the seam.
 *
 * They used to short-circuit on a per-device localStorage flag and write the host's inbox row
 * themselves, so nothing ever reached the API and the server's 409s were correct and unreachable.
 * What this spec protects is the part that is easy to get wrong once they *are* wired: a repeat
 * ask is a BENIGN 409 and must read as information, not as a red "something went wrong"; and
 * `group_full` is a DIFFERENT 409 on the same door and needs its own message.
 *
 * The tone is asserted structurally, on the toast's own container class (`border-rose-…` is the
 * error variant in ToastContext), because the words alone cannot tell a calm message from an
 * alarming one — and the words are the thing a future edit is most likely to change.
 */

const SEEKER = { name: 'Interest Tester', mobile: '9811100011', role: 'buyer' };
const ROOM_SOCIETY = 'Skyline Heights'; // SEED_ROOMS rm1, and nobody's own room

/** A group somebody else hosts, with one seat still open. */
const OPEN_GROUP = {
  id: 'g-d181-open',
  title: 'Last seat in a Baner 2BHK',
  locality: 'Baner',
  policy: 'any',
  rent: 30000,
  seatsTotal: 2,
  seatsOpen: 1,
  members: [{ name: 'Host', initials: 'HO', verified: false }],
  ownerMobile: '9800000009',
  ownerName: 'Someone Else',
  modStatus: 'approved',
  tags: [],
  note: 'Seeded for D181.',
  time: '1 hour ago',
};

/* `addInitScript` re-runs on EVERY navigation, so both writes are guarded: without the guard a
   reload would restore the pristine fixture over whatever the test had just done to it — including
   putting the first seeker back after a test has deliberately signed in as somebody else. The
   session marker cannot be used here because the point of the guard is to survive a reload. */
async function seedSeeker(page, groups = []) {
  await page.addInitScript(([user, gs]) => {
    if (!localStorage.getItem('puneNestUser')) {
      localStorage.setItem('puneNestUser', JSON.stringify({ ...user, loginAt: Date.now() }));
    }
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({
      necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now(),
    }));
    if (gs.length && !localStorage.getItem('puneNestFlatmateGroups')) {
      localStorage.setItem('puneNestFlatmateGroups', JSON.stringify(gs));
    }
  }, [SEEKER, groups]);
}

/** The most recent toast, and whether it is the error (rose) variant. */
const toast = (page) => page.getByRole('alert').last();
const isErrorToast = async (page) => ((await toast(page).getAttribute('class')) || '').includes('rose');

test('a first room enquiry reaches the provider and the card flips to sent', async ({ page }) => {
  const errors = trackErrors(page);
  await seedSeeker(page);
  await page.goto('/flatmates?view=rooms');

  const card = page.locator('.sf-card', { hasText: ROOM_SOCIETY }).first();
  await card.getByRole('button', { name: /Message owner/i }).click();

  await expect(page.getByText(`Message sent to the owner of ${ROOM_SOCIETY}.`)).toBeVisible({ timeout: 5000 });
  expect(await isErrorToast(page), 'a successful enquiry must not render as an error').toBe(false);
  await expect(card.getByRole('button', { name: /Interest sent/i })).toBeVisible();

  // The provider — not the page — is what wrote the ledger row the repeat ask collides with.
  // Its own store, deliberately separate from the `puneNestFlatmateInterests` map the page keeps
  // of its own taps: one stands in for the server's unique index, the other is device memory.
  const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('pnMockFlatmateInterests') || '{}'));
  expect(Object.keys(ledger)).toContain(`${SEEKER.mobile}|room|rm1`);
  expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
});

test('the same seeker on a second device is told the owner already holds the enquiry, not that a thread is waiting', async ({ page }) => {
  await seedSeeker(page);
  await page.goto('/flatmates?view=rooms');

  const card = () => page.locator('.sf-card', { hasText: ROOM_SOCIETY }).first();
  await card().getByRole('button', { name: /Message owner/i }).click();
  await expect(page.getByText(`Message sent to the owner of ${ROOM_SOCIETY}.`)).toBeVisible({ timeout: 5000 });

  /* A second device, expressed the only way a single browser can: drop what THIS one remembers
     asking, keep the provider's ledger. The button comes back — as it would on the seeker's other
     phone, where nothing was ever written — so the repeat ask genuinely reaches the provider.
     Reloading alone would not do it: the done-state is persisted on purpose (`prefreeze.spec.js`),
     and that persistence is memory, not a short-circuit. */
  await page.evaluate(() => localStorage.removeItem('puneNestFlatmateInterests'));
  await page.reload();
  const again = card().getByRole('button', { name: /Message owner/i });
  await again.waitFor({ state: 'visible', timeout: 10_000 });
  await again.click();

  /* The benign 409 states what the server knows and stops there. It must NOT say the seeker has a
     message waiting to be read: the Messages thread is written on the success path into the
     first device's localStorage, and this test is standing on the second one, where there is
     nothing to open. Copy that sends them to Messages here is a lie (D183). */
  await expect(page.getByText(`The owner of ${ROOM_SOCIETY} already has your earlier enquiry`)).toBeVisible({ timeout: 5000 });
  expect(await isErrorToast(page), 'a repeat tap must not become a red error toast').toBe(false);
  await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  // It really did already happen, so the card is right to sit in its sent state.
  await expect(card().getByRole('button', { name: /Interest sent/i })).toBeVisible();
});

/* ── D183 (second half) — the 409 has to leave the DEVICE where the success path would ──
 *
 * The copy half shipped above: the toast tells the seeker what the server knows and does not
 * promise a thread. That was correct about the wording and left the state wrong. The bell entry
 * and the Messages hand-off are written by the page into localStorage, on the success path only,
 * so the second device flipped its card to "Interest sent" over an inbox that had never heard of
 * the enquiry. The fix is not more careful words — it is writing the same record on both paths.
 */

/** Everything this browser knows about its own asks, minus the provider's ledger — i.e. the seeker's
 *  OTHER phone: same account, same server-side interest, nothing local. `pnMockFlatmateInterests`
 *  survives because it stands in for the server's unique index, which is what raises the 409. */
async function forgetDevice(page) {
  await page.evaluate(() => {
    ['puneNestFlatmateInterests', 'pnPendingRequests', 'pnConversations', 'puneNestNotifications']
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.reload();
}

const queuedFor = (page, propertyId) => page.evaluate(
  (id) => JSON.parse(localStorage.getItem('pnPendingRequests') || '[]').filter((r) => r?.propertyId === id),
  propertyId,
);
const threadsFor = (page, propertyId) => page.evaluate(
  (id) => JSON.parse(localStorage.getItem('pnConversations') || '[]').filter((c) => c?.propertyId === id && c.youAre === 'buyer'),
  propertyId,
);

/* Open the inbox on the tab a fresh ask actually lands on.

   `loadConversations` gives a handed-off request `state: 'pending'`, and `Messages.inTab` files
   anything pending or incoming under Requests — Chats is only `state: 'active'`, i.e. threads the
   other side has already answered. Asserting on the default tab would miss the row no matter how
   correctly the hand-off was written, which is the opposite of what these tests are for. */
const openInboxRequests = async (page) => {
  await page.goto('/messages');
  await page.getByRole('tab', { name: /Requests/i }).click();
};

test('a second device that never made the enquiry still ends up holding the thread behind its sent card', async ({ page }) => {
  await seedSeeker(page);
  await page.goto('/flatmates?view=rooms');

  const card = () => page.locator('.sf-card', { hasText: ROOM_SOCIETY }).first();
  await card().getByRole('button', { name: /Message owner/i }).click();
  await expect(page.getByText(`Message sent to the owner of ${ROOM_SOCIETY}.`)).toBeVisible({ timeout: 5000 });

  await forgetDevice(page);
  // Precondition, and the thing that makes the assertions below mean something: this device really
  // does start with nothing. If the fixture ever leaks the queue across the reload the test is void.
  expect(await queuedFor(page, 'room-rm1'), 'the second device must start with no thread').toEqual([]);

  const again = card().getByRole('button', { name: /Message owner/i });
  await again.waitFor({ state: 'visible', timeout: 10_000 });
  await again.click();
  await expect(page.getByText(`The owner of ${ROOM_SOCIETY} already has your earlier enquiry`)).toBeVisible({ timeout: 5000 });

  /* THE assertion. Before the fix this array is empty: the 409 branch returned after the toast, so
     the card flipped to "Interest sent" and Messages stayed empty — the state the shipped copy was
     carefully worded around instead of fixing. Revert `recordAskLocally` out of the 409 branch in
     `useFlatmates.onRoomInterest` and this line goes red. */
  expect(await queuedFor(page, 'room-rm1'), 'the 409 must leave this device the same hand-off the success path writes').toHaveLength(1);
  const notifs = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestNotifications') || '[]'));
  expect(notifs.some((n) => /Room enquiry sent/i.test(n?.title || '')), 'and the same bell entry').toBe(true);

  // And it is a real thread, not just a row: the card's sent state now has somewhere to point.
  await expect(card().getByRole('button', { name: /Interest sent/i })).toBeVisible();
  await openInboxRequests(page);
  await expect(page.getByText(`Room in ${ROOM_SOCIETY}`).first()).toBeVisible({ timeout: 10_000 });
});

test('a repeat enquiry does not give the device that made it a second thread', async ({ page }) => {
  await seedSeeker(page);
  await page.goto('/flatmates?view=rooms');

  const card = () => page.locator('.sf-card', { hasText: ROOM_SOCIETY }).first();
  await card().getByRole('button', { name: /Message owner/i }).click();
  await expect(page.getByText(`Message sent to the owner of ${ROOM_SOCIETY}.`)).toBeVisible({ timeout: 5000 });

  /* Open Messages once, which is what makes this the hard case: `loadConversations()` drains
     `pnPendingRequests` into `pnConversations` and deletes the queue. A repeat-write guard that
     only looks at the queue sees nothing here and duplicates the thread. */
  await openInboxRequests(page);
  await expect(page.getByText(`Room in ${ROOM_SOCIETY}`).first()).toBeVisible({ timeout: 10_000 });
  expect(await queuedFor(page, 'room-rm1'), 'the inbox consumes the queue on mount').toEqual([]);
  expect(await threadsFor(page, 'room-rm1')).toHaveLength(1);

  // Forget only the tap memory, so the CTA is offered again on the device that already has the thread.
  await page.evaluate(() => localStorage.removeItem('puneNestFlatmateInterests'));
  await page.goto('/flatmates?view=rooms');
  const again = card().getByRole('button', { name: /Message owner/i });
  await again.waitFor({ state: 'visible', timeout: 10_000 });
  await again.click();
  await expect(page.getByText(`The owner of ${ROOM_SOCIETY} already has your earlier enquiry`)).toBeVisible({ timeout: 5000 });

  expect(await queuedFor(page, 'room-rm1'), 'nothing to re-queue — this device already holds the thread').toEqual([]);
  await page.goto('/messages');
  expect(await threadsFor(page, 'room-rm1'), 'one ask, one thread, however many times it is repeated').toHaveLength(1);
});

test('a second device that never made the join request still ends up holding the thread', async ({ page }) => {
  await seedSeeker(page, [OPEN_GROUP]);
  await page.goto('/flatmates?view=groups');

  const card = () => page.locator('.sf-card', { hasText: OPEN_GROUP.title }).first();
  await card().getByRole('button', { name: /Join group/i }).click();
  await expect(page.getByText(`Joined ${OPEN_GROUP.title}. Continue in Messages.`)).toBeVisible({ timeout: 5000 });

  await forgetDevice(page);
  expect(await queuedFor(page, `group-${OPEN_GROUP.id}`), 'the second device must start with no thread').toEqual([]);

  const again = card().getByRole('button', { name: /Join group/i });
  await again.waitFor({ state: 'visible', timeout: 10_000 });
  await again.click();
  await expect(page.getByText(/already has your earlier request/i)).toBeVisible({ timeout: 5000 });

  // The third sibling door, fixed with the same call — they diverge the moment only one is patched.
  expect(await queuedFor(page, `group-${OPEN_GROUP.id}`), 'the join 409 must write the same hand-off too').toHaveLength(1);
  await openInboxRequests(page);
  await expect(page.getByText(OPEN_GROUP.title).first()).toBeVisible({ timeout: 10_000 });
});

test('a group that fills while the board is on screen answers group_full, not already-asked', async ({ page }) => {
  await seedSeeker(page, [OPEN_GROUP]);
  await page.goto('/flatmates?view=groups');

  const card = page.locator('.sf-card', { hasText: OPEN_GROUP.title }).first();
  const join = card.getByRole('button', { name: /Join group/i });
  await join.waitFor({ state: 'visible', timeout: 10_000 });

  /* Take the last seat behind the page. The board is a snapshot, so the button is still offered —
     which is the race `group_full` exists for, and the reason the client-side seat pre-check had
     to go: it would have answered from stale data instead of asking. */
  await page.evaluate((id) => {
    const rows = JSON.parse(localStorage.getItem('puneNestFlatmateGroups') || '[]');
    rows.forEach((g) => { if (g.id === id) g.seatsOpen = 0; });
    localStorage.setItem('puneNestFlatmateGroups', JSON.stringify(rows));
  }, OPEN_GROUP.id);

  await join.click();

  await expect(page.getByText(`${OPEN_GROUP.title} is already full.`)).toBeVisible({ timeout: 5000 });
  expect(await isErrorToast(page), 'a refused join is a real error and should look like one').toBe(true);
  // Not the other 409 on the same door, and not the generic fallback.
  await expect(page.getByText(/already has your earlier request/i)).toHaveCount(0);
  await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);

  /* Rolled back AND corrected. Rollback alone would restore a live `Join group` on a card still
     claiming a free seat, so the only move left is to tap again and be refused again — the 409 is
     the one authoritative word that the snapshot is stale, so it has to be spent on refreshing it. */
  await expect(card.getByRole('button', { name: /^Join group$/i })).toHaveCount(0);
  await expect(card.getByText(/full/i).first()).toBeVisible({ timeout: 5000 });
});

test('a seeker who already asked is told the group is full, not that they already asked', async ({ page }) => {
  await seedSeeker(page, [OPEN_GROUP]);
  await page.goto('/flatmates?view=groups');

  const card = page.locator('.sf-card', { hasText: OPEN_GROUP.title }).first();
  await card.getByRole('button', { name: /Join group/i }).click();
  await expect(page.getByText(`Joined ${OPEN_GROUP.title}. Continue in Messages.`)).toBeVisible({ timeout: 5000 });

  /* Forget only this browser's memory of the ask, so the CTA is offered again. The provider's
     ledger keeps it, which is the whole point: they really have asked before. */
  await page.evaluate(() => localStorage.removeItem('puneNestFlatmateInterests'));
  await page.reload();

  const again = page.locator('.sf-card', { hasText: OPEN_GROUP.title }).first();
  const join = again.getByRole('button', { name: /Join group/i });
  await join.waitFor({ state: 'visible', timeout: 10_000 });

  /* Now take the last seat behind the page — after render, so the button is still there to press.
     Both conflicts are now true of the same request. The mock checks seats first because
     `FlatmateSupplyService.join` does, and the order carries the meaning: "you already asked" is
     true here but useless, because it implies a seat is still waiting on the host. Swap the two
     checks in the mock and only this test notices. */
  await page.evaluate((id) => {
    const rows = JSON.parse(localStorage.getItem('puneNestFlatmateGroups') || '[]');
    rows.forEach((g) => { if (g.id === id) g.seatsOpen = 0; });
    localStorage.setItem('puneNestFlatmateGroups', JSON.stringify(rows));
  }, OPEN_GROUP.id);

  await join.click();

  await expect(page.getByText(`${OPEN_GROUP.title} is already full.`)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/already has your earlier request/i)).toHaveCount(0);
});

test('an ordinary failure rolls the card back instead of leaving it claiming success', async ({ page }) => {
  await seedSeeker(page, [OPEN_GROUP]);
  await page.goto('/flatmates?view=groups');

  const card = page.locator('.sf-card', { hasText: OPEN_GROUP.title }).first();
  const join = card.getByRole('button', { name: /Join group/i });
  await join.waitFor({ state: 'visible', timeout: 10_000 });

  /* Delete the row behind the page so the door throws a plain 404 — neither 409, so it lands on the
     generic branch. That branch is the one an optimistic UI gets wrong: without its rollback the
     card sits in a done state for an ask that never happened, and no other test in this file would
     say so, because every other test succeeds or is refused benignly. */
  await page.evaluate(() => localStorage.setItem('puneNestFlatmateGroups', '[]'));

  await join.click();

  expect(await isErrorToast(page), 'a real failure must read as one').toBe(true);
  await expect(card.getByRole('button', { name: /^(Joined|Requested)$/i })).toHaveCount(0);
});

test('the next person to sign in on a shared browser does not inherit the first one\'s asks', async ({ page }) => {
  await seedSeeker(page);
  await page.goto('/flatmates?view=rooms');

  const card = () => page.locator('.sf-card', { hasText: ROOM_SOCIETY }).first();
  await card().getByRole('button', { name: /Message owner/i }).click();
  await expect(card().getByRole('button', { name: /Interest sent/i })).toBeVisible({ timeout: 5000 });

  /* Sign in as somebody else, same browser, without clearing anything. The done-state is memory of
     a *person's* asks, not the device's: if it were global, B would be shown that A had contacted
     this owner, and — because the card gates its CTA on that same map — would have no button to
     press, so the provider would never be asked. That is the D181 failure wearing a different hat. */
  await page.evaluate(() => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Second Person', mobile: '9822200022', role: 'buyer', loginAt: Date.now(),
    }));
  });
  await page.reload();

  const theirs = card().getByRole('button', { name: /Message owner/i });
  await theirs.waitFor({ state: 'visible', timeout: 10_000 });
  await theirs.click();

  // Their own first ask — accepted, not refused as a duplicate of the other person's.
  await expect(page.getByText(`Message sent to the owner of ${ROOM_SOCIETY}.`)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/already messaged/i)).toHaveCount(0);
  const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('pnMockFlatmateInterests') || '{}'));
  expect(Object.keys(ledger)).toEqual(expect.arrayContaining([`${SEEKER.mobile}|room|rm1`, '9822200022|room|rm1']));
});
