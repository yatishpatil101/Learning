import { test, expect, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, uploadedListingPhotos, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

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
  await expect.poll(() => new URL(page.url()).searchParams.get('budget') || '', { timeout: 5000 })
    .toMatch(new RegExp(`-${value}$`));
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
    // Baner, so it never lands in the Aundh the empty-tab test below needs bare.
    locality: 'Baner',
    title: `Zztest flatmate discovery ${Date.now()}`,
    images: await uploadedListingPhotos(accessToken),
  });
  expect(listing.status, listing.text).toBe(201);
  created.listingId = listing.json.id;

  const approved = await approveListingWithFetch(listing.json.id, adminHeaders);
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
    const rejected = await rejectListingWithFetch(created.listingId, await authHeaders(ACTORS.admin), {
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

  test('Move in now holds only places; Team up holds only people', async ({ page, consoleErrors }) => {
    await openFlatmates(page);
    await cardsRendered(page);
    const places = await cardIds(page);
    expect(places.length).toBeGreaterThan(0);
    expect(places.every((id) => id.startsWith('r:') || id.startsWith('g:'))).toBe(true);
    /* Team up first, and wait for a `g:` card: `cardsRendered` is satisfied by room cards alone, so
       "no groups on Move-in" would otherwise be provable by a groups feed that had not answered. */

    await openTab(page, /Team up/i);
    await cardsRendered(page);
    const people = await cardIds(page);
    expect(people.length).toBeGreaterThan(0);
    expect(people.every((id) => id.startsWith('s:') || id.startsWith('g:'))).toBe(true);
    expect(people.some((id) => id.startsWith('s:'))).toBe(true);
    expect(consoleErrors).toEqual([]);
  });

  test('groups without an address sort into Team up', async ({ page }) => {
    /* Read from the wire first, so a seed that gained an addressed group fails here with a reason
       rather than turning the assertion below into a tautology. */
    const feed = await fetch(`${API}/flatmates/feed?tab=team-up&size=100`).then((r) => r.json());
    const groups = (feed.content || []).filter((row) => row.seatsTotal !== undefined);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((g) => !g.propertyId && !g.society)).toBe(true);

    await openFlatmates(page);
    await openTab(page, /Team up/i);
    await expect(page.locator('[data-sf-id^="g:"]').first()).toBeVisible({ timeout: 15_000 });
    const peopleGroups = (await cardIds(page)).filter((id) => id.startsWith('g:'));

    await openTab(page, /Move in now/i);
    await cardsRendered(page);
    const placeGroups = (await cardIds(page)).filter((id) => id.startsWith('g:'));

    expect(peopleGroups.length).toBeGreaterThan(0);
    expect(placeGroups).toHaveLength(0);
  });

  test('legacy ?view= deep links still resolve', async ({ page }) => {
    await openFlatmates(page, '?view=rooms');
    await expect(page.locator('button[aria-current="page"]')).toHaveText(/Move in now/);
    await openFlatmates(page, '?view=groups');
    await expect(page.locator('button[aria-current="page"]')).toHaveText(/Team up/);
  });
  test('a shareable room stays visible to a budget only its split price fits', async ({ page }) => {
    /* Both rooms are read off the live board rather than named, so the per-room / per-person pair
       cannot go stale against the seed. */
    const board = await fetch(`${API}/flatmates/feed?tab=move-in&size=100`).then((r) => r.json());
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

    await expect.poll(() => cardIds(page)).not.toContain(`r:${perPerson.id}`);
    expect(await cardIds(page)).toContain(`r:${flat.room.id}`);

    const card = page.locator(`[data-sf-id="r:${flat.room.id}"]`);
    await expect(card.getByText(/each, if shared/i)).toBeVisible();
    await card.getByRole('link').first().click();
    await expect(page.getByText(/each if \d share/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('the room detail page carries the split choice into the enquiry', async ({ page }) => {
    await signedInAs(page, uniqueMobile());
    await page.goto(`/flatmates/room/${flat.room.id}`);
    await expect(page.getByText('How will you take it?')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'With someone I know' }).click();

    const sent = page.waitForRequest((r) => r.url().endsWith(`/flatmates/rooms/${flat.room.id}/interest`) && r.method() === 'POST');
    await page.getByRole('button', { name: 'Send interest' }).click();
    expect((await sent).postDataJSON().share).toBe('bring');
    await expect(page.getByRole('button', { name: /Interest sent/i })).toBeVisible({ timeout: 10_000 });
  });

  test('an empty tab offers the other tab instead of a dead end', async ({ page }) => {
    /* Checked on the wire: the day a spec publishes an Aundh room, this should fail saying so
       rather than timing out on a locator and sending the reader to the wrong screen. */
    const board = await fetch(`${API}/flatmates/feed?tab=move-in&size=100`).then((r) => r.json());
    const aundh = board.content.filter((r) => r.locality === 'Aundh' || (r.localities || []).includes('Aundh'));
    expect(aundh, 'the seed now has an approved Aundh Move-in row, so Move-in is not empty').toHaveLength(0);

    const rooms = page.waitForResponse((r) => r.url().includes('/flatmates/feed') && r.url().includes('tab=move-in') && r.ok());
    await openFlatmates(page, '?view=move-in&loc=Aundh');
    await rooms;

    const rescue = page.getByText(/match these filters/i);
    await expect(rescue).toBeVisible();
    expect(await cardIds(page)).toHaveLength(0);

    await page.getByRole('button', { name: /^Team up$/ }).first().click();
    // Switching must carry the filter over — the rescue promised these results.
    await expect(page.locator('button[aria-current="page"]')).toHaveText(/Team up/);
    await cardsRendered(page);
    expect((await cardIds(page)).length).toBeGreaterThan(0);
  });

  test('a vacant flat is disclosed on the room page and labelled by kind on the board', async ({ page }) => {
    await test.step('discloses that a vacant flat has no flatmates yet', async () => {
      await page.goto(`/flatmates/room/${flat.room.id}`);
      await expect(page.getByText('No flatmates yet').filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
    });

    await test.step('labels each room by kind', async () => {
      await openFlatmates(page, '?view=move-in');
      /* Both lines hang off `occupancy`, which the server derives from the flat's committed count —
         `flatCommitted: 0` is what makes this flat vacant, and no client sets it. */
      const card = page.locator(`[data-sf-id="r:${flat.room.id}"]`);
      await expect(card.getByText(/Master bedroom/)).toBeVisible();
    });
  });
});
