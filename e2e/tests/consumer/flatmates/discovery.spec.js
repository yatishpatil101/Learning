import { test, expect, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, uniqueMobile } from '../../../helpers/liveAuth.js';

/** Card ids currently rendered, e.g. ['r:...', 's:...', 'g:...']. */
const cardIds = (page) =>
  page.locator('[data-sf-id]').evaluateAll((els) => els.map((e) => e.dataset.sfId));

/** The three feeds are HTTP round trips, so counting cards before one renders reads `[]` as empty. */
const cardsRendered = (page) => page.locator('.sf-card').first().waitFor({ timeout: 15_000 });

/* A tab in the strip, never the rescue CTA sharing its i18n name. Unscoped, strict mode fails
   whenever one feed has answered and another has not — a race that looks like flakiness. */
const tab = (page, name) => page.getByRole('button', { name }).first();
const openTab = (page, name) => tab(page, name).click();

/** The Flatmates page, with the lazy route resolved rather than merely requested. */
async function openFlatmates(page, query = '') {
  await page.goto('/flatmates' + query, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
  await expect(tab(page, /Move in now/i)).toBeVisible();
}

/* Drive the budget MAXIMUM: `.rng` holds two range inputs and [1] is the ceiling, so grabbing the
   first would narrow from the wrong end. Duplicates `helpers/app.js:setBudget`, which is mock-era. */
async function setBudget(page, value) {
  await page.evaluate((v) => {
    const sliders = document.querySelectorAll('.rng input[type="range"]');
    if (sliders.length < 2) throw new Error(`budget slider not found (got ${sliders.length} range inputs)`);
    const slider = sliders[1];
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

/* Ids are recorded step by step so a fixture that dies halfway is still torn down — see
   `docs/system/fixture-registry.md`. */
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
    // A real entry in `GET /localities` so the row is filed rather than queued for curation — and
    // Baner, so it never lands in the Aundh the empty-tab test below needs bare.
    locality: 'Baner',
    title: `Zztest flatmate discovery ${Date.now()}`,
  });
  expect(listing.status, listing.text).toBe(201);
  created.listingId = listing.json.id;

  const approved = await api('PATCH', `/properties/${listing.json.id}/status`, adminHeaders, {
    status: 'approved',
  });
  expect(approved.status, approved.text).toBe(200);

  /* A cap of 3 is what the client turns into `shareMax`, so the card offers both the two-way and
     three-way split — the state the price line below asserts. */
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

/* Fresh tokens, independent cleanups, and the split route rather than the room route — the reasons
   are in `docs/system/fixture-registry.md`. */
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

    /* `[1-9]` rather than `\d`: `tabCount` renders `0` while the feeds are in flight, so a `\d`
       would hold on a page that had counted nothing. */
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
    /* Read from the wire first, so a seed that gained an addressed group fails here with a reason
       rather than turning the assertion below into a tautology. */
    const groups = await fetch(`${API}/flatmates/groups?size=100`).then((r) => r.json());
    expect(groups.content.length).toBeGreaterThan(0);
    expect(groups.content.every((g) => !g.propertyId && !g.society)).toBe(true);

    await openFlatmates(page);
    /* Team up first, and wait for a `g:` card: `cardsRendered` is satisfied by room cards alone, so
       "no groups on Move-in" would otherwise be provable by a groups feed that had not answered. */
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
    /* Both rooms are read off the live board rather than named, so the per-room / per-person pair
       cannot go stale against the seed. */
    const board = await fetch(`${API}/flatmates/rooms?size=100`).then((r) => r.json());
    const perPerson = board.content.find((r) => r.priceBasis === 'person' && r.budget > 10000);
    expect(perPerson, 'the seed no longer has a per-person room above ₹10,000').toBeTruthy();

    await openFlatmates(page, '?view=move-in');
    await cardsRendered(page);

    /* Assert both are present at the default budget first: `not.toContain` below is otherwise
       satisfied by a room that was never rendered at all. */
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
    /* Checked on the wire: the day a spec publishes an Aundh room, this should fail saying so
       rather than timing out on a locator and sending the reader to the wrong screen. */
    const board = await fetch(`${API}/flatmates/rooms?size=100`).then((r) => r.json());
    const aundh = board.content.filter((r) => (r.localities || []).includes('Aundh'));
    expect(aundh, 'the seed now has an approved Aundh room, so Move-in is not empty').toHaveLength(0);

    /* Wait for the board's own feed, not the rescue, which also renders while a feed is in flight.
       Pinned to `tab=move-in`: the `size=1` badge probe answers first and would resolve this. */
    const rooms = page.waitForResponse((r) => r.url().includes('/flatmates/feed') && r.url().includes('tab=move-in') && r.ok());
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

    /* Both lines hang off `occupancy`, which the server derives from the flat's committed count —
       `flatCommitted: 0` is what makes this flat vacant, and no client sets it. */
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

