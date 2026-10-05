import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

const uniqueTitle = (kind) => `Live ${kind} tier ${Date.now().toString(36)} in Baner`;

async function publish(groupId) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const response = await fetch(`${API}/admin/flatmates/${groupId}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e tier browser fixture' }),
  });
  expect(response.status).toBeLessThan(300);
}

async function createGroup(token, body) {
  const response = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(body),
  });
  const group = await response.json();
  expect(response.status, JSON.stringify(group)).toBe(201);
  track('groups', group.id, token);
  await publish(group.id);
  return group;
}

async function createRoom(token, society) {
  const response = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(token),
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
      photos: ['https://cdn.example/live-identity-room.jpg'],
      ...(await tenantRoomAgreement(token)),
    }),
  });
  const room = await response.json();
  expect(response.status, JSON.stringify(room)).toBe(201);
  track('rooms', room.id, token);
  await publish(room.id);
  return room;
}

async function openMoveIn(page) {
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
}

async function openFilters(page) {
  const toggle = page.getByRole('button', { name: /^Filters/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

test('an owner-tier group renders Owner-verified and Verified only removes a real unapproved tenant room', async ({ page }) => {
  const { accessToken: ownerToken } = await apiLogin(ACTORS.owner);
  const listings = await (await fetch(`${API}/me/listings?size=50`, { headers: auth(ownerToken) })).json();
  const listing = listings.content.find((row) => row.status === 'approved');
  expect(listing, 'the seeded owner needs an approved listing').toBeTruthy();

  const ownerTitle = uniqueTitle('owner');
  const ownerGroup = await createGroup(ownerToken, {
    title: ownerTitle,
    name: 'Verified Owner',
    locality: listing.locality || 'Baner',
    rent: 42000,
    seats: 2,
    seatsOpen: 1,
    policy: 'any',
    role: 'owner',
    propertyId: listing.id,
  });
  expect(ownerGroup.verificationTier).toBe('owner');

  const { accessToken: identityToken } = await apiLogin(uniqueMobile());
  const identityRoom = await createRoom(identityToken, `Live tenant review room ${Date.now().toString(36)}`);
  expect(identityRoom.verificationTier).toBe('tenant');

  await signedInAsNew(page);
  await openMoveIn(page);
  const ownerCard = page.locator('.sf-card', { hasText: ownerTitle }).first();
  const identityCard = page.locator(`[data-sf-id="r:${identityRoom.id}"]`);
  await expect(ownerCard).toBeVisible({ timeout: 15_000 });
  await expect(identityCard).toBeVisible({ timeout: 15_000 });
  await expect(ownerCard.getByRole('img', { name: 'Owner-verified', exact: true })).toBeVisible();

  await openFilters(page);
  await page.getByRole('button', { name: 'Verified only', exact: true }).click();
  await expect(ownerCard).toBeVisible();
  await expect(identityCard).toHaveCount(0);
});