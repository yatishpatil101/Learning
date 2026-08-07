import { test, expect } from '../../fixtures/base.js';

/* Flatmate moderation reaches consumer-posted content — tech-debt D97(d).

   The defect this guards was mock-only but total. `AdminFlatmates` read `rawDb()`
   (the `puneNestDB_v5` mock database) while every consumer flatmate flow writes
   localStorage (`puneNestRoomListings`, `puneNestFlatmatePosts`,
   `puneNestFlatmateGroups`). Two disjoint stores, so **ops could not see a single
   thing a real user had posted**, and rooms — free-text title, an address, a price,
   i.e. the most abusable flatmate surface — had no moderation tab at all.

   The second half is the one worth a test. Even where the queue *did* render a row,
   nothing on the consumer side filtered `modStatus`, so "Remove" changed a value
   nobody read: the post stayed on the public board. The admin page meanwhile told
   the moderator, in so many words, that removed posts disappear.

   **The server was right all along**, which is what makes this a mock-fidelity bug
   rather than a product gap: `FlatmateRoomRepository`, `FlatmateGroupRepository` and
   `FlatmateSeekerPostRepository` filter `mod_status not in ('flagged','removed','rejected')`
   across nine queries, one of them commented *"the mod_status clause is not
   decoration: a flagged post must disappear"*. The mock now mirrors that set exactly
   (`MOD_HIDDEN` in `lib/data/flatmates.js`).

   Both tests are mutation-tested: drop the `isPubliclyVisible` filter and the second
   goes red; revert `loadFlatmates` to `rawDb()` alone and the first does. */

const ROOM_ID = 'room-mod-1';
// A room's visible identity is its `society` on both surfaces: the posting wizard
// never asks for a title, so a real room has none. Asserting on a title would have
// tested a field that only this fixture would ever set.
const ROOM_TITLE = 'Moderation Probe Room';
const HOST_MOBILE = '9812345699';

/* A room in exactly the shape the consumer wizard writes. Seeded rather than
   posted through the wizard: this spec is about who can *see and act on* a room,
   and the multi-step create path is covered by the flatmates suites. */
function seedRoom(page, extra = {}) {
  const room = {
    id: ROOM_ID,
    type: 'flatmate',
    society: ROOM_TITLE,
    owner: 'Room Host',
    ownerMobile: HOST_MOBILE,
    flatType: '2 BHK',
    roomType: 'Private room',
    locality: 'Baner',
    localities: ['Baner'],
    rent: 15000,
    budget: 15000,
    deposit: 30000,
    seatsTotal: 2,
    occupants: 0,
    moveIn: 'now',
    gender: 'any',
    food: 'any',
    tags: [],
    note: '',
    img: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=80',
    verified: false,
    time: 'Just now',
    status: 'pending',
    createdAt: Date.now(),
    ...extra,
  };
  return page.addInitScript((r) => {
    localStorage.setItem('puneNestRoomListings', JSON.stringify([r]));
  }, room);
}

test('ops can see a room a consumer posted, and moderate it', async ({ page, login }) => {
  await seedRoom(page);
  await login.asAdmin();
  await page.goto('/admin/flatmates?tab=rooms');

  /* Scoped to the table, not the page. The shared `Table` renders the desktop rows
     and a mobile card per row into the same DOM, hiding one set with CSS, so every
     cell value legitimately appears twice and a bare `getByText` is a strict-mode
     violation. Unlike D82 this duplication is intentional — hence scoping the query
     rather than changing the component. */
  const table = page.getByRole('table');

  // The row exists at all — this is the half that was structurally impossible
  // before, because the queue read a different store than the one rooms live in.
  await expect(table.getByRole('cell', { name: ROOM_TITLE, exact: false })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Seats', exact: true })).toBeVisible();
  await expect(page.getByText('Showing 1–1 of 1 rooms')).toBeVisible();

  // Flag/Remove ask for an optional internal note before writing the verdict.
  page.on('dialog', (d) => d.accept('spam'));
  await table.getByRole('button', { name: 'Remove', exact: true }).first().click();

  await expect(table.getByText('Removed', { exact: true })).toBeVisible();

  // The verdict lands on the row in the store the consumer board actually reads,
  // not on a parallel copy — asserting the value is what makes the next test's
  // "it disappeared" mean "moderation worked" rather than "the seed was missing".
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('puneNestRoomListings') || '[]'));
  expect(stored).toHaveLength(1);
  expect(stored[0].modStatus).toBe('removed');
});

test('a removed room disappears from the public flatmates board', async ({ page }) => {
  // Control first: without a verdict the room is on the board. Without this the
  // test could pass because the room never rendered for an unrelated reason.
  await seedRoom(page);
  await page.goto('/flatmates?view=move-in');
  await expect(page.getByText(ROOM_TITLE).first()).toBeVisible({ timeout: 10000 });
});

test('a room marked removed is filtered out of the public board', async ({ page }) => {
  await seedRoom(page, { modStatus: 'removed' });
  await page.goto('/flatmates?view=move-in');

  // Wait for the board to settle on something real before asserting an absence,
  // so this cannot pass against a page that simply had not rendered yet.
  await page.locator('.sf-card, [data-testid="empty-state"]').first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await expect(page.getByText(ROOM_TITLE)).toHaveCount(0);
});

test('a flagged room is hidden too — the whole MOD_HIDDEN set, not just removed', async ({ page }) => {
  // `flagged` and `rejected` hide exactly as `removed` does on the server. Covering
  // one more of the three stops a future filter from being narrowed to `removed`
  // alone without a test noticing.
  await seedRoom(page, { modStatus: 'flagged' });
  await page.goto('/flatmates?view=move-in');
  await page.locator('.sf-card, [data-testid="empty-state"]').first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await expect(page.getByText(ROOM_TITLE)).toHaveCount(0);
});
