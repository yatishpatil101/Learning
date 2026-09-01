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
   rather than a product gap — but this docblock described the server's rule backwards
   for as long as it existed, and the two tests below were written to match the
   description rather than the code. It said:

     "`FlatmateRoomRepository`, `FlatmateGroupRepository` and `FlatmateSeekerPostRepository`
      filter `mod_status not in ('flagged','removed','rejected')` across nine queries …
      The mock now mirrors that set exactly (`MOD_HIDDEN` in `lib/data/flatmates.js`)."

   Both halves are false. The server filters `r.modStatus in ('live','approved')` — an
   **allow-list**, not an exclusion list — and there is no `MOD_HIDDEN` anywhere in the
   frontend; the export is `MOD_PUBLIC = ['live', 'approved']`. The mock is correct and
   always was. It was the prose that drifted, which is the worse way round: the code that
   would have corrected a reader is the code a reader trusts the comment instead of.

   That is not a spelling difference, and it is the whole reason for the third test below.
   A blacklist and a whitelist agree on `flagged`, `removed` and `rejected` and disagree on
   every state nobody has thought of yet — including `pending`, which since D72 is the state
   **every new post is born in**. `lib/data/flatmates.js` says so in as many words: "a new
   state — `pending` … — must be invisible by default. With a blacklist the board would have
   shown every unreviewed post until somebody remembered to add the new word here."

   So the two absence tests that used to be the whole of this file could not fail for the
   regression the design exists to prevent. Rewrite `isPubliclyVisible` as the blacklist its
   comment warned against and both stay green while every unreviewed post in the city goes
   public. The `pending` test is the one that goes red, and it is the only one of the three
   that distinguishes the shipped design from the rejected one.

   All three absence tests are mutation-tested, and the mutation is the blacklist above:
   rewriting `isPubliclyVisible` that way leaves `removed` and `flagged` green and turns
   `pending` red, on its own. Reverting `loadFlatmates` to `rawDb()` alone reddens the control.

   **Mutate the right module.** There are two exports named `isPubliclyVisible` and they take
   different arguments: `lib/data/flatmates.js` takes the row object and is used only to label
   the author's own copy in `Results.jsx`, while `services/providers/http/flatmateMapper.js`
   takes the bare `modStatus` string and is the one both providers filter public feeds through.
   The board answers to the mapper. Mutating the other one changes nothing on this page and
   reads as a spec that cannot fail — which cost a full run to work out, hence this paragraph.

   **Truncated (wave 2c part 3).** The first half of this file drove `/admin/flatmates`,
   which is retired — `/ops/flatmate-review` moderates rooms against the real API, and
   `ops/live-flatmate-moderation.spec.js` proves the verdict reaches the public feed for
   real rather than through two mock stores. What is left is the **consumer** half: that
   the mock board honours `MOD_PUBLIC`, which is what keeps mock mode an honest rehearsal
   of D72 for as long as it exists. It dies with the mock at P5c. */


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

/* Named for what it asserts. It used to be called "a removed room disappears from the public
 * flatmates board", which is the opposite of its body — it seeds no verdict and asserts the room
 * is *there*. That reads as a harmless slip until you notice the list reporter prints titles and
 * nothing else, so a run of this file appeared to cover removal twice and the visible-by-default
 * case not at all. The control is the load-bearing test here: every other test in the file is an
 * absence, and an absence proves nothing unless something in the same fixture is known to show up. */
test('a room with no verdict is on the public board — the control the absences rest on', async ({ page }) => {
  // Without this, every assertion below could pass against a board that rendered nothing at all.
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

test('a flagged room is hidden too — not just the one word the previous test names', async ({ page }) => {
  // `flagged` and `rejected` are outside `MOD_PUBLIC` exactly as `removed` is. Covering a
  // second one stops a future filter from being narrowed to `removed` alone without a test
  // noticing. It does *not* prove the allow-list — see the next test for that.
  await seedRoom(page, { modStatus: 'flagged' });
  await page.goto('/flatmates?view=move-in');
  await page.locator('.sf-card, [data-testid="empty-state"]').first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await expect(page.getByText(ROOM_TITLE)).toHaveCount(0);
});

/* The test that tells the two designs apart.
 *
 * `pending` is not a moderation verdict — it is the absence of one, and since D72 it is the state
 * every new post is born in. That makes it the only state whose visibility depends on whether
 * `isPubliclyVisible` is written as an allow-list or a deny-list, and therefore the only one worth
 * a test: the two above pass under either, because `removed` and `flagged` are named on one side
 * and excluded on the other.
 *
 * The failure this catches is also the largest one available on this surface. `removed` leaking
 * means one post a moderator wanted gone is still up; `pending` leaking means **every unreviewed
 * post in the city is public by default**, and it fails silently, because a board full of posts is
 * what a working board looks like. That asymmetry is precisely why `lib/data/flatmates.js` chose a
 * whitelist and said so, and why the choice deserves a test rather than a comment. */
test('an unreviewed room is hidden — the allow-list, not a list of bad words', async ({ page }) => {
  await seedRoom(page, { modStatus: 'pending' });
  await page.goto('/flatmates?view=move-in');
  await page.locator('.sf-card, [data-testid="empty-state"]').first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await expect(page.getByText(ROOM_TITLE)).toHaveCount(0);
});

