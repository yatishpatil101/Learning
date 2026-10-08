import { test, expect } from '@playwright/test';
import { ACTORS } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, uploadedListingPhotos, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { trackErrors } from '../../../helpers/console.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';
import { withSocietyId } from '../../../helpers/liveSociety.js';

const track = flatmateCleanup(test);
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const unique = (tag) => `Detail ${tag} ${Date.now().toString(36)}`;

async function hostsGroup(token, title) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ title, name: 'Detail Host', locality: 'Baner', rent: 30000, seats: 3, seatsOpen: 1, policy: 'any', role: 'tenant' }),
  });
  expect(res.status, 'seeding a group').toBe(201);
  const group = await res.json();
  track('groups', group.id, token);
  return group;
}

async function hostsPost(token) {
  const res = await fetch(`${API}/flatmates/posts`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ name: 'Detail Seeker', gender: 'female', age: 26, occupation: 'Engineer', budget: 18000, localities: ['Baner'], moveIn: '2026-12-01', flatPref: 'women', roomPref: 'private', tags: [], note: 'Detail page coverage' }),
  });
  expect(res.status, 'seeding a seeker post').toBe(201);
  const post = await res.json();
  track('posts', post.id, token);
  return post;
}

test.describe('LIVE: flatmate detail page', () => {
  test('the host reaches a pending group from My Listings and manages it; strangers cannot see it', async ({ page, browser }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const title = unique('Group');
    const group = await hostsGroup(accessToken, title);
    await signedInAs(page, mobile);
    const errors = trackErrors(page);

    await page.goto('/dashboard#listings');
    const card = page.locator('.rounded-xl').filter({ hasText: title }).first();
    await card.getByRole('link', { name: 'View listing' }).click();
    await expect(page).toHaveURL(new RegExp(`/flatmates/group/${group.id}$`));

    const panel = page.getByTestId('flatmate-owner-panel');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText('Under review');
    await expect(page.getByText(title).first()).toBeVisible();
    await expect(page.locator('.sf-card.reveal').first(), 'reduced motion hides a missing reveal hook, so assert the class it adds').toHaveClass(/\bvisible\b/);

    await panel.getByRole('link', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit group' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const renamed = `${title} v2`;
    await dialog.getByPlaceholder('e.g. 2 girls → 1 more for a 2BHK in Baner').fill(renamed);
    const patched = page.waitForResponse((r) => r.url().endsWith(`/flatmates/groups/${group.id}`) && r.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    expect((await patched).status(), 'the edit should reach the server').toBe(200);
    await expect(page).toHaveURL(new RegExp(`/flatmates/group/${group.id}$`));
    await expect(page.getByText(renamed).first()).toBeVisible({ timeout: 20_000 });

    const stranger = await browser.newPage();
    await stranger.goto(`${new URL(page.url()).origin}/flatmates/group/${group.id}`);
    await expect(stranger.getByTestId('flatmate-detail-missing')).toBeVisible({ timeout: 20_000 });
    await expect(stranger.getByTestId('flatmate-owner-panel')).toHaveCount(0);
    await stranger.close();

    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('the author opens a seeker post, sees it as theirs, and deletes it from the page', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const post = await hostsPost(accessToken);
    await signedInAs(page, mobile);
    const errors = trackErrors(page);

    await page.goto(`/flatmates/post/${post.id}`);
    const panel = page.getByTestId('flatmate-owner-panel');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Your post').first()).toBeVisible();
    await expect(page.locator('.sf-card.reveal').first()).toHaveClass(/\bvisible\b/);
    await expect(panel.getByRole('link', { name: 'Requests' })).toHaveCount(0);

    page.once('dialog', (d) => d.accept());
    const deleted = page.waitForResponse((r) => r.url().endsWith(`/flatmates/posts/${post.id}`) && r.request().method() === 'DELETE');
    await panel.getByRole('button', { name: 'Delete' }).click();
    expect((await deleted).status()).toBeLessThan(300);
    await expect(page).toHaveURL(/\/dashboard#listings$/);

    const gone = await fetch(`${API}/flatmates/posts/${post.id}`, { headers: auth(accessToken) });
    expect(gone.status, 'the deleted post should no longer resolve').toBe(404);
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('the host sees their room card fade in on the detail page, and its photos use the property page viewer: dots and counter on a phone, thumbnails and a lightbox', async ({ page }) => {
    test.slow();
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const society = unique('Gallery');
    const photos = await uploadedListingPhotos(accessToken, 3);
    const res = await fetch(`${API}/flatmates/rooms`, {
      method: 'POST',
      headers: auth(accessToken),
      body: JSON.stringify({ ...(await withSocietyId(accessToken, { society })), roomType: 'Private room', locality: 'Baner', rentShare: 18000, bhk: '2', attachedBath: 'attached', furnishing: 'semi', hostRole: 'tenant', photos, ...(await tenantRoomAgreement(accessToken)) }),
    });
    expect(res.status, 'seeding a room').toBe(201);
    const room = await res.json();
    track('rooms', room.id, accessToken);
    await signedInAs(page, mobile);
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 440, height: 900 });

    await page.goto(`/flatmates/room/${room.id}`);

    await test.step('the host sees their room card fade in on the detail page', async () => {
      await expect(page.getByTestId('flatmate-owner-panel')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(society).first()).toBeVisible();
      await expect(page.locator('.sf-card.reveal').first()).toHaveClass(/\bvisible\b/);
      await expect(page.getByText('Semi-Furnished')).toBeVisible();
      await expect(page.getByText(/property\./)).toHaveCount(0);
      expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
    });

    await test.step('a room\'s photos use the property page viewer: dots and counter on a phone, thumbnails and a lightbox', async () => {
      const hero = page.locator('.main-image-wrapper').first();
      await expect(hero).toContainText('1/3', { timeout: 20_000 });
      const dots = page.locator('[data-gallery-dots] button');
      await expect(dots).toHaveCount(3);
      await dots.nth(1).click();
      await expect(hero).toContainText('2/3');

      await page.locator('[data-gallery-track] img').nth(1).click();
      const lightbox = page.getByRole('dialog');
      await expect(lightbox.locator('.dz-lb-caption')).toHaveText('2 / 3');
      await page.keyboard.press('ArrowRight');
      await expect(lightbox.locator('.dz-lb-caption')).toHaveText('3 / 3');
      await page.keyboard.press('Escape');
      await expect(page.locator('.dz-lightbox')).toHaveCount(0);

      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.locator('button.thumbnail')).toHaveCount(3);
      await expect(page.locator('.req-photos-tile')).toHaveCount(0);
      await page.getByRole('button', { name: 'Fullscreen' }).click();
      await expect(page.locator('.dz-lightbox .dz-lb-caption')).toHaveText('3 / 3');
    });
  });
  test('the owner of a split room steps people up to the flat cap, then + is disabled', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const listing = await fetch(`${API}/me/listings`, {
      method: 'POST',
      headers: auth(accessToken),
      body: JSON.stringify({ deal: 'rent', propertyType: 'Flat', price: 30000, city: 'Pune', bhk: 2, area: 850, locality: 'Baner', title: unique('Split'), images: await uploadedListingPhotos(accessToken) }),
    }).then((r) => r.json());
    const adminHeaders = await authHeaders(ACTORS.admin);
    try {
      expect((await approveListingWithFetch(listing.id, adminHeaders)).status).toBe(200);
      const split = await fetch(`${API}/properties/${listing.id}/split`, {
        method: 'POST',
        headers: auth(accessToken),
        body: JSON.stringify({ maxOccupants: 1, rooms: [{ roomKind: 'master', rent: 15000 }] }),
      });
      expect(split.status, 'splitting the flat').toBe(201);
      const room = (await split.json()).rooms[0];

      await signedInAs(page, mobile);
      await page.goto(`/flatmates/room/${room.id}`);
      const panel = page.getByTestId('flatmate-owner-panel');
      const add = panel.getByRole('button', { name: 'Add a person to this room' });
      await expect(add).toBeEnabled({ timeout: 20_000 });
      await add.click();
      await expect(page.getByText(/Reissue the rent agreement/).first()).toBeVisible();
      await expect(add).toBeDisabled();
    } finally {
      await fetch(`${API}/properties/${listing.id}/split`, { method: 'DELETE', headers: auth(accessToken) });
      await rejectListingWithFetch(listing.id, await authHeaders(ACTORS.admin), { reason: 'Zztest cleanup — detail-page split fixture' });
    }
  });

  test('an unknown id shows a plain not-found state', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/flatmates/room/00000000-0000-0000-0000-000000000000');
    await expect(page.getByTestId('flatmate-detail-missing')).toBeVisible({ timeout: 20_000 });
    expect(errors.filter((e) => !/404/.test(e)), `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});
