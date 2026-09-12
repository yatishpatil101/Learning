import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { trackErrors } from '../../../helpers/console.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';

/** Live coverage verifies caller-scoped listings, including moderation-hidden posts. */

const track = flatmateCleanup(test);

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

const unique = (tag) => `Live Listings ${tag} ${Date.now().toString(36)}`;

/** A seeker request, created over HTTP for the tests whose subject is the *panel*, not the form. */
async function hostsPost(token, { locality = 'Baner', name = 'Listings Seeker' } = {}) {
  const res = await fetch(`${API}/flatmates/posts`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      name,
      gender: 'female',
      age: 26,
      occupation: 'Engineer',
      budget: 18000,
      localities: [locality],
      moveIn: '2026-12-01',
      flatPref: 'women',
      roomPref: 'private',
      tags: ['Vegetarian'],
      note: 'My Listings coverage',
    }),
  });
  expect(res.status, 'seeding a seeker post').toBe(201);
  const post = await res.json();
  track('posts', post.id, token);
  return post;
}

async function hostsGroup(token, title) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      title,
      name: 'Listings Host',
      locality: 'Baner',
      rent: 30000,
      seats: 3,
      seatsOpen: 1,
      policy: 'any',
      role: 'tenant',
    }),
  });
  expect(res.status, 'seeding a group').toBe(201);
  const group = await res.json();
  track('groups', group.id, token);
  return group;
}

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
  expect(res.status, 'seeding a room').toBe(201);
  const room = await res.json();
  track('rooms', room.id, token);
  return room;
}

/** The My Listings panel, reached the way the product links to it. */
async function openMyListings(page) {
  await page.goto('/dashboard#listings');
  await expect(page.getByRole('button', { name: 'Filter listings by type' })).toBeVisible({ timeout: 20_000 });
}

test.describe('LIVE: my flatmate listings', () => {
  test('a request posted through the form is accepted by the server, not just by the screen', async ({ page }) => {
    const mobile = await signedInAsNew(page);

    await page.goto('/flatmates?post=1');
    await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 20_000 });

    await page.getByPlaceholder('e.g. Riya').fill('Form Seeker');
    await page.locator('input[placeholder="₹ e.g. 15000"]').fill('16000');
    await page.getByRole('button', { name: 'Preferred localities' }).click();
    await page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Preferred localities' })).toContainText('Baner');

    /* The response, not the toast. A form that renders "posted" while the request 400s is exactly
       the failure this file exists to catch, and the mock could never produce it. */
    const posted = page.waitForResponse(
      (r) => r.url().includes('/flatmates/posts') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Post request/i }).click();
    const created = await posted;
    expect(created.status(), 'the server should accept the form payload').toBe(201);

    const { accessToken } = await apiLogin(mobile);
    const body = await created.json();
    track('posts', body.id, accessToken);

    /* And the server agrees it belongs to this caller — read back on a connection the page is not
       holding, so a purely client-side "success" cannot satisfy it. */
    const mine = await (await fetch(`${API}/me/flatmate-posts?size=100`, { headers: auth(accessToken) })).json();
    const rows = mine.content ?? mine.items ?? mine;
    expect(rows.map((r) => r.id), 'the post should be on the caller own board').toContain(body.id);
  });

  test('the posted request comes back on the board as the author own, still in review', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    await hostsPost(accessToken);
    await signedInAs(page, mobile);

    // Authors see pending posts so submissions remain visible before moderation.
    await page.goto('/flatmates?view=team-up');
    await expect(page.getByText('Your request · in review', { exact: true })).toBeVisible({ timeout: 20_000 });

    await openMyListings(page);
    await expect(page.getByText('Looking to share — Baner').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Flatmate request').first()).toBeVisible();
  });

  test('the type filter narrows My Listings to requests, and the group goes away', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const title = unique('Group');
    await hostsPost(accessToken);
    await hostsGroup(accessToken, title);
    await signedInAs(page, mobile);

    await openMyListings(page);

    /* Both first, positively. See the header: an empty panel satisfies "no group" on its own, so the
       narrowing is only observable from a state that provably had the group in it. */
    const group = page.getByText(title, { exact: true }).first();
    const request = page.getByText('Looking to share — Baner').first();
    await expect(group).toBeVisible({ timeout: 20_000 });
    await expect(request).toBeVisible();

    const filter = page.getByRole('button', { name: 'Filter listings by type' });
    await filter.click();
    /* `Select` portals its menu and only flips `portalOpen` one frame after opening (Select.jsx),
       until when it is `opacity: 0; pointer-events: none`. */
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.locator('.dz-dropdown__option', { hasText: 'Flatmate requests' }).first().click();

    await expect(group, 'the group should be filtered out').toBeHidden();
    await expect(request, 'the request should survive its own filter').toBeVisible();
  });

  test('a group-only host still gets a My Listings tab, and their group in it', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const title = unique('OnlyGroup');
    await hostsGroup(accessToken, title);
    await signedInAs(page, mobile);

    // Groups alone qualify a host for the My Listings surface.
    await openMyListings(page);
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Flatmate group').first()).toBeVisible();
  });

  test('a room the host posted appears on their own board before anyone has approved it', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const society = unique('Room');
    await hostsRoom(accessToken, society);
    await signedInAs(page, mobile);

    await openMyListings(page);
    await expect(page.getByText(society, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('the room wizard writes through the API and returns its room on My Listings', async ({ page }) => {
    const mobile = await signedInAsNew(page);
    const society = unique('Wizard Room');

    await page.goto('/list-property?flatmate=1');
    await expect(page.locator('.lp-meter')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-err="bhk"] .radio-pill', { hasText: '2 BHK' }).click();
    await page.locator('[data-err="roomType"] .radio-pill', { hasText: 'Private room' }).click();
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('[data-err="locality"]').click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first().click();
    await page.locator('input[data-err="society"]').fill(society);
    await page.locator('input[data-err="rentShare"]').fill('13500');
    await pickDate(page, '[data-err="availableFrom"]', '2026-12-01');
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'room.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'),
    });
    await expect(page.locator('.grid img')).toHaveCount(1);

    const posted = page.waitForResponse(
      (r) => r.url().includes('/flatmates/rooms') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Post & Find Flatmates/i }).click();
    const response = await posted;
    expect(response.status(), 'the wizard should create a room through the API').toBe(201);
    const room = await response.json();
    const { accessToken } = await apiLogin(mobile);
    track('rooms', room.id, accessToken);

    /* Read the room back from outside the browser. The status check above only proves the request
       left; this proves the server kept it, and that what it kept is what the wizard was told to
       send. Anything asserted from inside the page could be satisfied by a browser-side copy. */
    const mine = await fetch(`${API}/me/flatmate-rooms`, { headers: auth(accessToken) })
      .then((r) => r.json());
    const rows = mine.content || mine.items || mine;
    expect(rows.map((r) => r.society), 'the server did not keep the room the wizard posted')
      .toContain(society);

    /* And the wizard kept no copy of its own. Until this commit the room post ran through a fork in
       product code — `isHttpDomain('flatmate') ? createRoom(...) : persistFlatmate(...)` — whose
       else-branch wrote `draazyRoomListings` directly, the very key the mock provider writes. Both
       arms are one provider now and the fork is gone, so a browser-side room store appearing here
       again means the seam has been stepped around a second time.

       This is checked live rather than in the mock suite because in mock mode that key is written on
       purpose, by the provider — there the presence of a row proves nothing either way. Live, the
       only thing that could have written it is product code that should not have. */
    const stored = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('draazyRoomListings') || '[]') || []; }
      catch { return []; }
    });
    expect(stored, 'the wizard kept a browser-side copy of a server room').toEqual([]);

    await expect(page.getByText(/Flatmate Listing Posted/i)).toBeVisible({ timeout: 20_000 });
    await openMyListings(page);
    await expect(page.getByText(society, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('the flatmates board opens against the API without the app throwing', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/flatmates');

    /* Matched on the aria-label, which is the count-bearing string ("Move in now — N homes with a
       room available"). The visible label is a `<span>` beside a count badge, so an accessible-name
       match on the short label alone is brittle. */
    await expect(page.getByRole('button', { name: /Move in now —/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Team up —/i })).toBeVisible();
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});
