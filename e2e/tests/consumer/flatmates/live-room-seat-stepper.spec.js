import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Browser half of standalone room seat management.
 *
 * A standalone room is a one-seat vacancy by server design. This test creates it over HTTP,
 * publishes it through the moderation route, then uses the host card controls and independently
 * reads the caller-scoped endpoint after each action. It does not invent a room in localStorage.
 *
 * Owner-tier room badges are not coupled to this path: a standalone room has no property reference
 * in `FlatmateRoomCreate`, so the server correctly derives identity tier. Owner-tier rooms are
 * created by the property split flow and are covered by `live-discovery.spec.js`.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function publish(roomId) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const response = await fetch(`${API}/admin/flatmates/${roomId}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e room seat fixture' }),
  });
  expect(response.status).toBeLessThan(300);
}

async function myRoom(token, roomId) {
  const response = await fetch(`${API}/me/flatmate-rooms?size=50`, { headers: auth(token) });
  expect(response.status).toBe(200);
  const page = await response.json();
  const room = page.content.find((row) => row.id === roomId);
  expect(room, 'the host should still own the room').toBeTruthy();
  return room;
}

test('the host closes and reopens a real standalone room seat from its card', async ({ page }) => {
  const mobile = await signedInAsNew(page);
  const { accessToken } = await apiLogin(mobile);
  const society = `Live room seats ${Date.now().toString(36)}`;
  const created = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({
      bhk: '2',
      roomType: 'Private room',
      attachedBath: 'attached',
      furnishing: 'semi',
      locality: 'Baner',
      society,
      rentShare: 15000,
      deposit: 30000,
      availableFrom: '2026-12-01',
      lookingFor: 'any',
      foodPref: 'any',
      hostRole: 'tenant',
      photos: ['https://cdn.example/live-room-seat.jpg'],
    }),
  });
  const room = await created.json();
  expect(created.status, JSON.stringify(room)).toBe(201);
  track('rooms', room.id, accessToken);
  await publish(room.id);

  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  const card = page.locator(`[data-sf-id="r:${room.id}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(/1 seat open/i)).toBeVisible();

  await expect(card.locator('.seat-close-btn')).toBeVisible();
  await card.locator('.seat-close-btn').click();
  await expect(card.getByText(/^Filled$/)).toBeVisible({ timeout: 10_000 });
  expect((await myRoom(accessToken, room.id)).seatsOpen).toBe(0);

  await expect(card.locator('.seat-reopen-btn')).toBeEnabled();
  await card.locator('.seat-reopen-btn').click();
  await expect(card.getByText(/1 seat open/i)).toBeVisible({ timeout: 10_000 });
  expect((await myRoom(accessToken, room.id)).seatsOpen).toBe(1);
});