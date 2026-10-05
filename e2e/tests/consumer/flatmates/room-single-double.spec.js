import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';
import { PHOTO_PNG } from '../../../helpers/listingPhotos.helper.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function doubleRoom() {
  const { accessToken } = await apiLogin(uniqueMobile());
  const created = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({
      bhk: '2', roomType: 'Shared room', attachedBath: 'attached', furnishing: 'semi',
      locality: 'Baner', society: `Double room ${Date.now().toString(36)}`,
      rentShare: 15000, deposit: 30000, availableFrom: '2026-12-01',
      lookingFor: 'any', foodPref: 'any', hostRole: 'tenant', occupants: 2,
      photos: ['https://cdn.example/double-room.jpg'],
      ...(await tenantRoomAgreement(accessToken)),
    }),
  });
  const room = await created.json();
  expect(created.status, JSON.stringify(room)).toBe(201);
  track('rooms', room.id, accessToken);
  expect(room).toMatchObject({ seatsTotal: 2, seatsOpen: 2, priceBasis: 'room' });

  const admin = await apiLogin(ACTORS.admin);
  const published = await fetch(`${API}/admin/flatmates/${room.id}/moderation`, {
    method: 'PATCH', headers: auth(admin.accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e double room fixture' }),
  });
  expect(published.status).toBeLessThan(300);
  return { room, accessToken };
}

test.describe('single and double rooms', () => {
  test('the room wizard asks single or double and shows what each sharer pays', async ({ page }) => {
    await signedInAsNew(page);
    await page.goto(`${BASE}/list-property?flatmate=1`);
    await expect(page.locator('.lp-meter')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('This room is for *', { exact: true })).toBeVisible();
    await expect(page.getByText('People the flat can hold')).toHaveCount(0);
    await page.locator('[data-err="bhk"] .radio-pill', { hasText: '2 BHK' }).click();
    await page.locator('[data-err="roomType"] .radio-pill', { hasText: 'Double sharing (up to 2)' }).click();
    await page.getByText('I have a registered rent agreement', { exact: true }).click();
    await page.getByLabel('Upload registered rent agreement for room').setInputFiles({
      name: 'agreement.png', mimeType: 'image/png', buffer: PHOTO_PNG,
    });
    await page.getByLabel('The owner knows and agrees to sharing').check();
    await page.getByRole('button', { name: /Next Step/i }).click();

    await page.locator('[data-err="locality"]').click();
    await page.locator('.dz-dropdown__option', { hasText: 'Baner' }).first().click();
    await page.locator('input[data-err="society"]').fill('Double Room Heights');
    await page.getByRole('button', { name: /Next Step/i }).click();

    await expect(page.getByText('Rent & move-in', { exact: true })).toBeVisible();
    await expect(page.getByText('Room rent *', { exact: true })).toBeVisible();
    await page.locator('input[data-err="rentShare"]').fill('15000');
    await expect(page.getByTestId('room-rent-split')).toHaveText('₹7,500 each when 2 share');
  });

  test('a seeker sees the per-person price, and only sharing once one place is taken', async ({ page }) => {
    const { room, accessToken } = await doubleRoom();
    await page.goto(`${BASE}/flatmates/room/${room.id}`);
    await expect(page.getByText('From, per person / mo').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Room rent ₹15,000\/mo · ₹7,500 each if 2 share/).first()).toBeVisible();
    await expect(page.getByText(/Double sharing/).first()).toBeVisible();
    await expect(page.getByText('How will you take it?')).toBeVisible();

    const seats = await fetch(`${API}/flatmates/rooms/${room.id}/seats`, {
      method: 'PATCH', headers: auth(accessToken), body: JSON.stringify({ seatsOpen: 1 }),
    });
    expect(seats.status).toBe(200);
    expect(await seats.json()).toMatchObject({ seatsTotal: 2, seatsOpen: 1 });

    await page.reload();
    await expect(page.getByText(/1 person already in, you share the room/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Your share / mo').first()).toBeVisible();
    await expect(page.getByText('How will you take it?')).toHaveCount(0);
  });
});
