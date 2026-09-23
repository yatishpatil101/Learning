import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { trackErrors } from '../../../helpers/console.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { ACTORS } from '../../../fixtures/live.js';

const track = flatmateCleanup(test);

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

const unique = (tag) => `Live Listings ${tag} ${Date.now().toString(36)}`;

// Seed over HTTP when the panel, rather than the posting form, is under test.
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
    const localityPicker = page.getByRole('button', { name: 'Preferred localities' });
    await localityPicker.click();
    await page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first().click();
    await localityPicker.click();
    await expect(localityPicker).toContainText('Baner');

    // A success toast cannot prove the server accepted the payload.
    const posted = page.waitForResponse(
      (r) => r.url().includes('/flatmates/posts') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Post request/i }).click();
    const created = await posted;
    expect(created.status(), 'the server should accept the form payload').toBe(201);

    const { accessToken } = await apiLogin(mobile);
    const body = await created.json();
    track('posts', body.id, accessToken);

    // An independent read proves caller ownership rather than browser-local success.
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

    // Prove both kinds exist before filtering so an empty panel cannot satisfy the negative assertion.
    const group = page.getByText(title, { exact: true }).first();
    const request = page.getByText('Looking to share — Baner').first();
    await expect(group).toBeVisible({ timeout: 20_000 });
    await expect(request).toBeVisible();

    const filter = page.getByRole('button', { name: 'Filter listings by type' });
    await filter.click();
    // Portal mounting precedes interactivity by one animation frame.
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
    await page.getByText('Who lives here already', { exact: true }).locator('..')
      .getByRole('radio', { name: '2', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Notice period (days)' }).fill('30');
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('[data-err="locality"]').click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first().click();
    await page.locator('input[data-err="society"]').fill(society);
    await page.locator('input[data-err="rentShare"]').fill('13500');
    await pickDate(page, '[data-err="availableFrom"]', '2026-12-01');
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('[data-err="photos"] label.upload-zone input[type="file"]').setInputFiles({
      name: 'room.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=', 'base64'),
    });
    await expect(page.locator('.grid img')).toHaveCount(1);

    const posted = page.waitForResponse(
      (r) => r.url().includes('/flatmates/rooms') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Post & Find Flatmates/i }).click();
    const response = await posted;
    expect(response.status(), 'the wizard should create a room through the API').toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({ occupants: 2, noticePeriodDays: 30 });
    const room = await response.json();
    const { accessToken } = await apiLogin(mobile);
    track('rooms', room.id, accessToken);

    // An independent read proves the server kept the room and its selected details.
    const mine = await fetch(`${API}/me/flatmate-rooms`, { headers: auth(accessToken) })
      .then((r) => r.json());
    const rows = mine.content || mine.items || mine;
    expect(rows.map((r) => r.society), 'the server did not keep the room the wizard posted')
      .toContain(society);
    expect(rows.find((r) => r.id === room.id)).toMatchObject({ occupants: 2, noticePeriodDays: 30 });

    // A live server write must not leave a parallel browser-local room store.
    const stored = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('draazyRoomListings') || '[]') || []; }
      catch { return []; }
    });
    expect(stored, 'the wizard kept a browser-side copy of a server room').toEqual([]);

    await expect(page.getByText(/Flatmate Listing Posted/i)).toBeVisible({ timeout: 20_000 });
    await openMyListings(page);
    await expect(page.getByText(society, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    /* The public room card, unlike the dashboard summary, displays the home's details. The
       wizard stopped asking for them, but the PATCH still takes them and a room split off a
       whole listing inherits them, so the card keeps rendering them. The update revalidates a
       whole create request, so the wizard's own posted body is replayed with the outlook added.
       Set before approval, not after: `details` is a rechecked facet, so editing a live room
       returns it to the queue and takes it off the feed this test then reads. */
    const outlook = await fetch(`${API}/flatmates/rooms/${room.id}`, {
      method: 'PATCH', headers: auth(accessToken),
      body: JSON.stringify({ ...response.request().postDataJSON(), facing: 'East', overlooking: 'Garden' }),
    });
    expect(outlook.status, 'setting the outlook on a pending room').toBe(200);
    const admin = await apiLogin(ACTORS.admin);
    const approved = await fetch(`${API}/admin/flatmates/${room.id}/moderation`, {
      method: 'PATCH', headers: auth(admin.accessToken),
      body: JSON.stringify({ modStatus: 'live', note: 'Outlook regression fixture' }),
    });
    expect(approved.status).toBe(200);
    await page.goto('/flatmates?view=rooms');
    const card = page.locator('.sf-card').filter({ hasText: society });
    await expect(card.getByText('Facing: East', { exact: true })).toBeVisible();
    await expect(card.getByText('Overlooking: Garden', { exact: true })).toBeVisible();
  });

  /* "Independent House" and "Row House" are two of the four things the wizard asks the host to
     pick between, and they share a `propertyType` because a row house is let exactly like an
     independent house. The distinction lives only in `homeTypeLabel`, so a payload that drops it
     makes the two picks the same post. Asserted on the request body rather than only on the
     response, because the server has carried this column since V13 — it was the client that never
     sent it, and a test that reaches the API without the wizard would have stayed green. */
  test('picking Row House posts Row House rather than collapsing into Independent House', async ({ page }) => {
    const mobile = await signedInAsNew(page);
    const society = unique('Row House');

    await page.goto('/list-property?flatmate=1');
    await expect(page.locator('.lp-meter')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Row House', exact: true }).click();
    await page.locator('[data-err="bhk"] .radio-pill', { hasText: '2 BHK' }).click();
    await page.locator('[data-err="roomType"] .radio-pill', { hasText: 'Private room' }).click();
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('[data-err="locality"]').click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first().click();
    await page.locator('input[data-err="society"]').fill(society);
    await page.locator('input[data-err="rentShare"]').fill('14500');
    await pickDate(page, '[data-err="availableFrom"]', '2026-12-01');
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('[data-err="photos"] label.upload-zone input[type="file"]').setInputFiles({
      name: 'room.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=', 'base64'),
    });
    await expect(page.locator('.grid img')).toHaveCount(1);

    const posted = page.waitForResponse(
      (r) => r.url().includes('/flatmates/rooms') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Post & Find Flatmates/i }).click();
    const response = await posted;
    expect(response.status(), 'the wizard should create a room through the API').toBe(201);
    expect(response.request().postDataJSON(), 'the wizard dropped the host\u2019s pick')
      .toMatchObject({ homeTypeLabel: 'Row House' });

    const room = await response.json();
    const { accessToken } = await apiLogin(mobile);
    track('rooms', room.id, accessToken);

    const mine = await fetch(`${API}/me/flatmate-rooms`, { headers: auth(accessToken) })
      .then((r) => r.json());
    const rows = mine.content || mine.items || mine;
    expect(rows.find((r) => r.id === room.id)).toMatchObject({ homeTypeLabel: 'Row House' });
  });

  /* The column is free text with a V35 CHECK behind it, so an unlisted label is refused at the
     door. Without this the wizard's four options and any typo publish alike, and the post is
     simply missing its headline claim on a card nobody can filter. */
  test('a home type outside the four the wizard offers is refused, not published blank', async () => {
    const { accessToken } = await apiLogin(uniqueMobile());

    const res = await fetch(`${API}/flatmates/rooms`, {
      method: 'POST',
      headers: auth(accessToken),
      body: JSON.stringify({
        homeTypeLabel: 'Bungalow',
        bhk: '2',
        roomType: 'Private room',
        locality: 'Baner',
        society: unique('Bad Home Type'),
        rentShare: 14000,
        availableFrom: '2026-12-01',
        photos: ['https://cdn.example.com/room.png'],
      }),
    });
    expect(res.status, 'an unlisted home type should not reach the board').toBe(400);
    expect(JSON.stringify(await res.json()), 'the refusal should name the accepted tokens')
      .toContain('Row House');
  });

  test('the flatmates board opens against the API without the app throwing', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/flatmates');

    // The accessible name includes the count; the visible label alone does not identify the button.
    await expect(page.getByRole('button', { name: /Move in now —/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Team up —/i })).toBeVisible();
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});
