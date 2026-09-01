import { test, expect, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, uniqueMobile } from '../../../helpers/liveAuth.js';

/**
 * Demand side against the **live** board: how a seeker finds a home or a flatmate.
 *
 * The page is split by one question — "is there an address yet?" — so most of this file asserts
 * that the split holds: places on one side, people on the other, and no way to end up staring at a
 * dead end. `model.js:tabOf` is where that decision lives, and the wire fields it reads
 * (`propertyId`, `society`) are on every row the API serves.
 *
 * ## What the conversion changed, and why it is not a port
 *
 * Three of these tests describe a flat an owner is letting **room by room** — the vacant-home
 * disclosure, the "Master bedroom" label, and a room that stays affordable because two people can
 * split it. The mock supplied that flat as a literal in `db.json`. The live API refuses to: none of
 * `roomKind`, `priceBasis` or `shareMax` is settable on `POST /flatmates/rooms`, deliberately —
 * they are derived, and a client that could name its own `priceBasis` could price a shared bed as a
 * private room. The only thing that mints them is the act the product actually offers, `POST
 * /properties/{id}/split` (`FlatSplitService:171`), so this file performs it: an owner posts a rent
 * listing, Ops approves it, the owner splits it into one master bedroom, and a moderator publishes
 * the room. Every field those three tests read is then a value the server derived rather than one a
 * fixture asserted.
 *
 * That makes the assertions stronger than the ones they replace. The mock's budget test could only
 * say "some card is still here"; this one names the split room by id **and** names a seeded
 * per-person room, priced above the same budget, that is correctly gone.
 *
 * ## One test did not come across, and it is a gap rather than a deletion
 *
 * The mock file's last test — a signed-in seeker seeing their own live request banner — **cannot
 * pass against the API today**, and the reason is a missing capability, not a broken test.
 * `useFlatmates:142` derives `myPost` from `getMyRequest`, which reads `puneNestFlatmatePosts` in
 * `lib/data/flatmates.js`: the mock store, empty in http mode. There is nothing to repoint it at —
 * `Routes.Flatmates` has no "my seeker posts" route (`MY_REQUESTS` is the host's interest inbox, a
 * different entity), and the public feed masks `mobile` to null, so a live client cannot recognise
 * its own row at all. The consequence is wider than one banner: the own-post exclusion at
 * `useFlatmateDiscovery:112` never fires, so on the live board a seeker sees their own request as a
 * card they can express interest in. Recorded in `tasks/todo.md` with the endpoint it needs; the
 * mock test stays put until then — see `discovery.spec.js`, now that one test and a note.
 *
 * ## The DOM helpers are inlined rather than imported
 *
 * `helpers/app.js` reads `frontend/src/data/properties.json` at import time — mock data that P5c
 * deletes. Importing it here to reach three one-line DOM helpers would give the live suite a fresh
 * dependency on the thing the migration exists to remove, so the three are restated below. They are
 * pure DOM and carry no mock knowledge.
 */

/** Card ids currently rendered, e.g. ['r:...', 's:...', 'g:...']. */
const cardIds = (page) =>
  page.locator('[data-sf-id]').evaluateAll((els) => els.map((e) => e.dataset.sfId));

/**
 * Wait for the feed to have rendered something before counting it.
 *
 * The mock board came out of localStorage during render, so reading the cards straight after a
 * navigation was safe there and is not safe here: the three feeds are HTTP round trips, and a spec
 * that counts too early gets `[]` and reports it as "the tab is empty". This is the one difference
 * that made two of these tests pass alone and fail in file order.
 */
const cardsRendered = (page) => page.locator('.sf-card').first().waitFor({ timeout: 15_000 });

/**
 * A tab in the strip, and never the CTA that shares its name.
 *
 * Both tab names label two controls: the tab itself, and the rescue button an empty tab offers
 * (`Results.jsx:110` labels it with the *same* i18n string). So an unscoped `getByRole` resolves to
 * two elements and fails strict mode — but only while a rescue is mounted, which is any moment when
 * one of the three independent feeds has answered and another has not. That makes it a race that
 * shows up on the slower viewport and looks like flakiness. The strip is first in the DOM, so
 * `.first()` is the tab by construction.
 */
const tab = (page, name) => page.getByRole('button', { name }).first();
const openTab = (page, name) => tab(page, name).click();

/** The Flatmates page, with the lazy route resolved rather than merely requested. */
async function openFlatmates(page, query = '') {
  await page.goto('/flatmates' + query, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
  await expect(tab(page, /Move in now/i)).toBeVisible();
}

/** Drive the budget range input (React needs a native setter plus an input event). */
async function setBudget(page, value) {
  await page.evaluate((v) => {
    const slider = document.querySelector('input[type="range"]');
    if (!slider) throw new Error('budget slider not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(slider, String(v));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  // Let the filter memos settle before reading the list back.
  await page.waitForTimeout(400);
}


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

/**
 * A vacant flat on the public board, let room by room.
 *
 * Four calls because the product needs four, and each one is load-bearing:
 *
 *  1. a rent listing — `split` refuses anything else (`not_splittable`);
 *  2. Ops approval — an approved parent is what makes the split owner-tier, which is what exempts
 *     it from the anti-broker cap; an unapproved one lands as identity-tier and can be blocked;
 *  3. the split itself — the only writer of `roomKind`, `priceBasis: 'room'` and `maxOccupants`;
 *  4. moderation — split rooms are born `pending` like every other D72 row, so without this the
 *     room exists and the board cannot see it.
 *
 * The owner is minted per run rather than borrowed: `ACTORS.owner` holds the four anchor listings
 * that `live-listing-quota` is built on, and splitting one of hers would be editing another spec's
 * premise on a database that lives for the whole run.
 */
/**
 * What the fixture has created so far.
 *
 * Filled in step by step rather than returned at the end, because the steps can fail
 * independently: a `split` refused as `already_split`, or a moderation call that 500s, would
 * otherwise leave an **approved rent listing on the public site** with nothing recording that it
 * exists. Teardown runs when `beforeAll` throws — what would have been missing is the id, not the
 * opportunity.
 */
const created = { mobile: null, listingId: null, roomId: null };

async function splitFlat() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  created.mobile = mobile;
  const adminHeaders = await authHeaders(ACTORS.admin);

  const listing = await api('POST', '/me/listings', auth(accessToken), {
    deal: 'rent',
    propertyType: 'Flat',
    price: 36000,
    city: 'Pune',
    bhk: 2,
    area: 900,
    // A real entry in `GET /localities`, so the row is filed rather than dropped into the curation
    // queue — and Baner, so it never lands in the Aundh the empty-tab test below needs bare.
    locality: 'Baner',
    title: `Zztest flatmate discovery ${Date.now()}`,
  });
  expect(listing.status, listing.text).toBe(201);
  created.listingId = listing.json.id;

  const approved = await api('PATCH', `/properties/${listing.json.id}/status`, adminHeaders, {
    status: 'approved',
  });
  expect(approved.status, approved.text).toBe(200);

  /* One room, and a flat cap of three. `validateOccupancy` allows 1..rooms*MAX_PER_ROOM, and the
     cap is what the client turns into `shareMax` — at 3 the card offers both the two-way and the
     three-way split, which is the state the price line below is about. */
  const split = await api('POST', `/properties/${listing.json.id}/split`, auth(accessToken), {
    maxOccupants: 3,
    rooms: [{ roomKind: 'master', rent: 18000, note: 'Zztest — sunny corner room.' }],
  });
  expect(split.status, split.text).toBe(201);
  const room = split.json.rooms[0];
  created.roomId = room.id;

  const published = await api('PATCH', `/admin/flatmates/${room.id}/moderation`,
    await authHeaders(STAFF.rental), { modStatus: 'approved' });
  expect(published.status, published.text).toBe(200);

  return { mobile, listingId: listing.json.id, room };
}

/** The fixture is built once: it is four round trips, and nothing below mutates it. */
let flat;

test.beforeAll(async () => {
  flat = await splitFlat();
});

/**
 * Put the board back, whatever got built.
 *
 * The room is withdrawn rather than left standing because this database serves the whole run and
 * the flatmates board is counted by its neighbours — `live-filters` asserts that narrowing a filter
 * *reduces* the list, and a stray extra Baner room is exactly the kind of thing that makes such an
 * assertion pass or fail on which file ran first. The listing is rejected rather than deleted
 * because there is no delete; rejection is what takes it off the public site.
 *
 * Two details that are the difference between a teardown and a hope:
 *
 *   * the two artefacts are cleaned **independently**, off `created`, so a fixture that died after
 *     the listing but before the split still takes the listing down;
 *   * the token is minted here rather than replayed from `beforeAll`. That one is fifteen minutes
 *     and thirteen tests × two viewports old by now, and `liveAuth.js:137` documents the TTL it is
 *     past — a 401 here would leave the room published for the rest of the run, and a discarded
 *     status would have let it do so silently.
 *
 * The room goes back through `DELETE /properties/{id}/split`, not `DELETE /flatmates/rooms/{id}`.
 * The per-room withdraw answers **409 `split_room`** — "stop letting the whole flat room by room
 * instead" — because a split is one decision about a flat rather than a stack of independent
 * postings. The first version of this file called the room route, discarded the status, and left
 * the published room on the public board for the rest of the run; asserting the status is what
 * found it. `unsplit` is refused once anyone has moved in, which nobody has here.
 *
 * What is deliberately left behind is the residue every sibling leaves: a rejected listing, one
 * `97…` account and two audit rows. Nothing asserts an absolute count of any of them.
 */
test.afterAll(async () => {
  if (created.roomId) {
    const unsplit = await api('DELETE', `/properties/${created.listingId}/split`,
      await authHeaders(created.mobile));
    expect(unsplit.status, unsplit.text).toBe(204);
  }
  if (created.listingId) {
    const rejected = await api('PATCH', `/properties/${created.listingId}/status`,
      await authHeaders(ACTORS.admin), {
        status: 'rejected',
        reason: 'Zztest cleanup — synthetic flatmate discovery fixture',
      });
    expect(rejected.status, rejected.text).toBe(200);
  }
});

test.describe('Flatmates discovery (live)', () => {
  test('shows two intent tabs with visible counts', async ({ page }) => {
    await openFlatmates(page);
    const moveIn = tab(page, /Move in now/i);
    const teamUp = tab(page, /Team up/i);
    await expect(moveIn).toBeVisible();
    await expect(teamUp).toBeVisible();
    await cardsRendered(page);

    /* Counts are rendered, not just announced — stock a seeker cannot see is stock they never
       switch tabs for. `[1-9]` rather than `\d`, because `tabCount` renders `0` while the feeds are
       in flight and a `\d` would be satisfied by that: the assertion would then hold on a page that
       had counted nothing. */
    await expect(moveIn).toContainText(/[1-9]/);
    await expect(teamUp).toContainText(/[1-9]/);
    await expect(moveIn).toHaveAttribute('aria-label', /[1-9]\d* homes/);
  });

  test('Move in now holds only places; Team up holds only people', async ({ page }) => {
    await openFlatmates(page);
    await cardsRendered(page);
    const places = await cardIds(page);
    expect(places.length).toBeGreaterThan(0);
    expect(places.every((id) => id.startsWith('r:') || id.startsWith('g:'))).toBe(true);

    await openTab(page, /Team up/i);
    await cardsRendered(page);
    const people = await cardIds(page);
    expect(people.length).toBeGreaterThan(0);
    expect(people.every((id) => id.startsWith('s:') || id.startsWith('g:'))).toBe(true);
    // A seeker only ever belongs with people.
    expect(people.some((id) => id.startsWith('s:'))).toBe(true);
  });

  test('groups without an address sort into Team up', async ({ page }) => {
    /* `tabOf` sends a group to Move-in only when it has an address (`propertyId || society`), and
       every group the API serves carries neither — they are sets of people still hunting rather
       than flats you could move into. Read from the wire first, so a seed that gained an addressed
       group would fail here with a reason rather than turning the assertion below into a tautology. */
    const groups = await fetch(`${API}/flatmates/groups?size=100`).then((r) => r.json());
    expect(groups.content.length).toBeGreaterThan(0);
    expect(groups.content.every((g) => !g.propertyId && !g.society)).toBe(true);

    await openFlatmates(page);
    /* Team up first, and wait for a `g:` card there.
       `cardsRendered` is not enough for this one: on Move-in it is satisfied by room cards alone,
       and groups arrive on their own `useAsyncList` hook — so "no groups on Move-in" would be
       provable by a groups feed that had simply not answered yet. Seeing a group card on Team up is
       what makes the absence on Move-in a statement about `tabOf` rather than about latency. */
    await openTab(page, /Team up/i);
    await expect(page.locator('[data-sf-id^="g:"]').first()).toBeVisible({ timeout: 15_000 });
    const peopleGroups = (await cardIds(page)).filter((id) => id.startsWith('g:'));

    await openTab(page, /Move in now/i);
    await cardsRendered(page);
    const placeGroups = (await cardIds(page)).filter((id) => id.startsWith('g:'));

    expect(peopleGroups.length).toBeGreaterThan(0);
    expect(placeGroups).toHaveLength(0);
  });

  test.describe('legacy ?view= deep links still resolve', () => {
    const cases = [
      ['rooms', /Move in now/],
      ['groups', /Team up/],
      ['flatmates', /Team up/],
      ['move-in', /Move in now/],
      ['team-up', /Team up/],
    ];
    for (const [value, expected] of cases) {
      test(`?view=${value}`, async ({ page }) => {
        await openFlatmates(page, `?view=${value}`);
        await expect(page.locator('button[aria-current="page"]')).toHaveText(expected);
      });
    }
  });

  test('a shareable room stays visible to a budget only its split price fits', async ({ page }) => {
    /* The comparison that makes this a test rather than a screenshot: a room the server prices per
       ROOM survives a budget below its rent because `roomMatches` compares `bestPerPersonRent`,
       while a room priced per PERSON at more than the budget is correctly gone. Both are read off
       the live board rather than named, so the pair cannot go stale against the seed. */
    const board = await fetch(`${API}/flatmates/rooms?size=100`).then((r) => r.json());
    const perPerson = board.content.find((r) => r.priceBasis === 'person' && r.budget > 10000);
    expect(perPerson, 'the seed no longer has a per-person room above ₹10,000').toBeTruthy();

    await openFlatmates(page, '?view=move-in');
    await cardsRendered(page);

    /* Both rooms are on the board at the default budget. Asserting this *first* is what makes the
       narrowing below a statement about the filter: `not.toContain` is otherwise satisfied by a
       room that was never rendered at all. */
    const before = await cardIds(page);
    expect(before).toContain(`r:${flat.room.id}`);
    expect(before).toContain(`r:${perPerson.id}`);

    await setBudget(page, 10000);

    const ids = await cardIds(page);
    // ₹18,000 for the room, and three may share it — so it is offered to a ₹10,000 budget, which is
    // the cheapest genuine way into a good society and the whole reason the split price is shown.
    expect(ids).toContain(`r:${flat.room.id}`);
    // …while the per-person room, priced above the same budget, is correctly gone.
    expect(ids).not.toContain(`r:${perPerson.id}`);

    const card = page.locator(`[data-sf-id="r:${flat.room.id}"]`);
    await expect(card.getByText(/each if \d share/i).first()).toBeVisible();
  });

  test('an empty tab offers the other tab instead of a dead end', async ({ page }) => {
    /* Aundh has seekers and a group but no rooms. Checked on the wire rather than trusted: the day
       a spec publishes an Aundh room, this should fail saying so instead of timing out on a
       locator and sending the reader to the wrong screen. */
    const board = await fetch(`${API}/flatmates/rooms?size=100`).then((r) => r.json());
    const aundh = board.content.filter((r) => (r.localities || []).includes('Aundh'));
    expect(aundh, 'the seed now has an approved Aundh room, so Move-in is not empty').toHaveLength(0);

    /* Wait for the rooms feed itself, not for the rescue. `Results.jsx:99` renders the rescue
       whenever the active list is empty, which a rooms feed still in flight also satisfies — so
       waiting on the rescue would let this test pass against a board that had not answered. */
    const rooms = page.waitForResponse((r) => r.url().includes('/flatmates/rooms') && r.ok());
    await openFlatmates(page, '?view=move-in&loc=Aundh');
    await rooms;

    const rescue = page.getByText(/match these same filters/i);
    await expect(rescue).toBeVisible();
    expect(await cardIds(page)).toHaveLength(0);

    // The rescue CTA, not the tab: its accessible name is exactly "Team up", the tab's carries a count.
    await page.getByRole('button', { name: /^Team up$/ }).first().click();

    // Switching must carry the filter over — the rescue promised these results.
    await expect(page.locator('button[aria-current="page"]')).toHaveText(/Team up/);
    await cardsRendered(page);
    expect((await cardIds(page)).length).toBeGreaterThan(0);
  });

  test('discloses that a vacant flat has no flatmates yet', async ({ page }) => {
    await openFlatmates(page, '?view=move-in');

    /* An owner letting an empty flat room by room is a different bet from a spare room in an
       occupied household: nobody vets you, and your flatmates are undecided. That has to be stated,
       not implied. Both lines hang off `occupancy`, which the server derives from the flat's
       committed count — `flatCommitted: 0` is what makes this flat vacant, and no client sets it. */
    const card = page.locator(`[data-sf-id="r:${flat.room.id}"]`);
    await expect(card.getByText('No flatmates yet')).toBeVisible();
    await expect(card.getByText(/One rent agreement covers/i)).toBeVisible();
  });

  test('labels each room by kind', async ({ page }) => {
    await openFlatmates(page, '?view=move-in');
    const card = page.locator(`[data-sf-id="r:${flat.room.id}"]`);
    await expect(card.getByText('Master bedroom', { exact: true })).toBeVisible();
  });

  test('renders no console errors on either tab', async ({ page, consoleErrors }) => {
    await openFlatmates(page);
    await openTab(page, /Team up/i);
    // A tab that never rendered raises no console errors either. The cards are what makes the
    // empty-errors claim below a statement about this tab rather than about a blank screen.
    await cardsRendered(page);
    expect(consoleErrors).toEqual([]);
  });
});

