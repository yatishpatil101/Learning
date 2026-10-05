import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { ACTORS } from '../../../fixtures/live.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';

const track = flatmateCleanup(test);

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

const unique = (tag) => `Live Listings ${tag} ${Date.now().toString(36)}`;
const ROOM_PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAeAAAAHgCAIAAADytinCAAAFG0lEQVR42u3UMQ0AAAgEsXeCX0SgFRUkDE2q4IZLTQPwUCQAMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQxaBQCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoFUAMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwbAoAEMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoCQAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAg1YBwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBrAoAEwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBjBoFQAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgATBoAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgADBrAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGgCDBjBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGwKABDBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEwaACDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAAwawKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgATBoAIMGwKABMGgAgwbAoAEMGgCDBsCgAQwaAIMGMGgADBoAgwYwaAAMGsCgAbiybdjfVMQITnoAAAAASUVORK5CYII=', 'base64');

async function fillTenantProof(page) {
  await page.getByText('I have a registered rent agreement', { exact: true }).click();
  await page.getByLabel('Upload registered rent agreement for room').setInputFiles({
    name: 'agreement.png',
    mimeType: 'image/png',
    buffer: ROOM_PHOTO,
  });
  await page.getByLabel('The owner knows and agrees to sharing').check();
}

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
      ...(await tenantRoomAgreement(token)),
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
    await page.getByLabel('Lowest monthly budget').fill('16000');
    const localityPicker = page.getByRole('button', { name: 'Preferred localities' });
    await localityPicker.click();
    await page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first().click();
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

  test('the posted request comes back on the board as the author own, live at once', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    await hostsPost(accessToken);
    await signedInAs(page, mobile);
    // Authors see pending posts so submissions remain visible before moderation.
    await page.goto('/flatmates?view=team-up');
    await expect(page.getByText('Your live request', { exact: true })).toBeVisible({ timeout: 20_000 });

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
    const { accessToken } = await apiLogin(mobile);
    const society = unique('Wizard Room');

    await page.goto('/list-property?flatmate=1');
    await expect(page.locator('.lp-meter')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-err="bhk"] .radio-pill', { hasText: '2 BHK' }).click();
    await page.locator('[data-err="roomType"] .radio-pill', { hasText: 'Single (1 person)' }).click();
    await page.getByRole('radiogroup', { name: 'People living in the flat now' })
      .getByRole('radio', { name: '2', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Notice period (days)' }).fill('30');
    await fillTenantProof(page);
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('[data-err="locality"]').click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first().click();
    await page.locator('input[data-err="society"]').fill(society);
    await page.getByRole('button', { name: /Next Step/i }).click();
    await expect(page.getByText('Rent & move-in', { exact: true })).toBeVisible();
    await page.locator('input[data-err="rentShare"]').fill('13500');
    await pickDate(page, '[data-err="availableFrom"]', '2026-12-01');
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('[data-err="photos"] label.upload-zone input[type="file"][multiple]').setInputFiles({
      name: 'room.png',
      mimeType: 'image/png',
      buffer: ROOM_PHOTO,
    });
    await expect(page.locator('[data-err="photos"]')).toContainText('1 / 10 photos');

    const suggested = await page.getByLabel('Headline').getAttribute('placeholder');
    expect(suggested).toMatch(/^Private room in 2 BHK /);
    expect(suggested).toContain(society);

    const posted = page.waitForResponse(
      (r) => r.url().includes('/flatmates/rooms') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Post & Find Flatmates/i }).click();
    const response = await posted;
    expect(response.status(), 'the wizard should create a room through the API').toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({ occupants: 2, noticePeriodDays: 30, title: suggested });
    const room = await response.json();
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
    await page.goto(`/flatmates/room/${room.id}`);
    const fact = (label) => page.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]');
    await expect(fact('Facing')).toHaveText('East', { timeout: 20_000 });
    await expect(fact('Overlooking')).toHaveText('Garden');
    await expect(page.getByText('2 people live in this flat now')).toBeVisible();
  });

  test('picking Row House posts Row House rather than collapsing into Independent House', async ({ page }) => {
    const mobile = await signedInAsNew(page);
    const { accessToken } = await apiLogin(mobile);
    const society = unique('Row House');

    await page.goto('/list-property?flatmate=1');
    await expect(page.locator('.lp-meter')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Row House', exact: true }).click();
    await page.locator('[data-err="bhk"] .radio-pill', { hasText: '2 BHK' }).click();
    await page.locator('[data-err="roomType"] .radio-pill', { hasText: 'Single (1 person)' }).click();
    await fillTenantProof(page);
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('[data-err="locality"]').click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first().click();
    await page.locator('input[data-err="society"]').fill(society);
    await page.getByRole('button', { name: /Next Step/i }).click();
    await expect(page.getByText('Rent & move-in', { exact: true })).toBeVisible();
    await page.locator('input[data-err="rentShare"]').fill('14500');
    await pickDate(page, '[data-err="availableFrom"]', '2026-12-01');
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('[data-err="photos"] label.upload-zone input[type="file"][multiple]').setInputFiles({
      name: 'room.png',
      mimeType: 'image/png',
      buffer: ROOM_PHOTO,
    });
    await expect(page.locator('[data-err="photos"]')).toContainText('1 / 10 photos');

    const posted = page.waitForResponse(
      (r) => r.url().includes('/flatmates/rooms') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Post & Find Flatmates/i }).click();
    const response = await posted;
    expect(response.status(), 'the wizard should create a room through the API').toBe(201);
    expect(response.request().postDataJSON(), 'the wizard dropped the host\u2019s pick')
      .toMatchObject({ homeTypeLabel: 'Row House' });
    const room = await response.json();
    track('rooms', room.id, accessToken);

    const mine = await fetch(`${API}/me/flatmate-rooms`, { headers: auth(accessToken) })
      .then((r) => r.json());
    const rows = mine.content || mine.items || mine;
    expect(rows.find((r) => r.id === room.id)).toMatchObject({ homeTypeLabel: 'Row House' });
  });

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
        ...(await tenantRoomAgreement(accessToken)),
      }),
    });
    expect(res.status, 'an unlisted home type should not reach the board').toBe(400);
    expect(JSON.stringify(await res.json()), 'the refusal should name the accepted tokens')
      .toContain('Row House');
  });
});
