import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * The Ops verification verdict, end to end.
 *
 * A sitting tenant cannot produce ownership papers, so they upload a registered rent agreement and
 * Ops decides. The product claim is that the badge is **earned rather than claimed**: uploading
 * evidence buys a queue entry, and only somebody else's approval turns it into "Tenant-verified".
 * This file drives the whole of that — post, queue, decide, render — against the real server.
 *
 * ## Why it did not exist until now
 *
 * Three mock specs used to own these assertions (`eligibility`, `rooms-tiers`,
 * `agreement-evidence`) and each carried a header saying the same thing: `useFlatmates` read the
 * verdict from `getFlatmateReviewStatusMap()`, a `localStorage` map the Ops desk wrote to the
 * *reviewer's own browser*. On the reviewer's machine every badge appeared exactly as designed and
 * on every other machine in the world the map was empty. So the card had no live-readable review
 * state, and the specs could only assert the labels by seeding the very state they existed to
 * prove.
 *
 * That is now fixed rather than worked around. `reviewStatus` is joined onto the feed and detail
 * rows server-side ({@code FlatmateReviewStatuses}), so the browser reads a verdict it could never
 * have known before, and the "Verified only" filter's tenant branch — deliberately omitted from the
 * server's own query because the board could not match it — is whole on both sides. These tests are
 * the browser half of that; `FlatmateSupplyEndpointsTest.ReviewStatusOnTheWire` is the route half.
 *
 * ## Shape
 *
 * Every row here is created over HTTP and published through real moderation, because the two gates
 * are independent and this file is about the second one: a post held by D72 is invisible for a
 * reason that has nothing to do with its host's papers, and conflating them would let a moderation
 * regression pass as a verification result.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function adminToken() {
  return (await apiLogin(ACTORS.admin)).accessToken;
}

/** Let a row past the D72 moderation gate, which is a different gate from the one under test. */
async function publish(id) {
  const response = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(await adminToken()),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e review-status fixture' }),
  });
  expect(response.status).toBeLessThan(300);
}

async function createGroup(token, body) {
  const response = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      locality: 'Baner', rent: 40000, seats: 3, seatsOpen: 1, policy: 'any', name: 'Review Host',
      ...body,
    }),
  });
  const group = await response.json();
  expect(response.status, JSON.stringify(group)).toBe(201);
  track('groups', group.id, token);
  await publish(group.id);
  return group;
}

async function createRoom(token, body) {
  const response = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      bhk: '2', roomType: 'Private room', attachedBath: 'attached', furnishing: 'semi',
      locality: 'Baner', rentShare: 15000, deposit: 30000, availableFrom: '2026-12-01',
      lookingFor: 'any', foodPref: 'any', photos: ['https://cdn.example/review-status.jpg'],
      ...body,
    }),
  });
  const room = await response.json();
  expect(response.status, JSON.stringify(room)).toBe(201);
  track('rooms', room.id, token);
  await publish(room.id);
  return room;
}

/**
 * Find the queue row behind a post and decide it as Ops would.
 *
 * Reads the queue rather than the database: the point of the test is that the verdict the desk
 * records is the verdict the board later shows, and going round the route would prove the two
 * halves of that separately while assuming the join between them.
 */
async function decide(target, decision, note = 'e2e verdict') {
  const token = await adminToken();
  const queue = await (await fetch(`${API}/admin/flatmate-reviews?size=100`, {
    headers: auth(token),
  })).json();
  const row = queue.content.find((r) => r.groupId === target || r.roomId === target);
  expect(row, `an agreement-backed post must be queued for Ops (${target})`).toBeTruthy();

  const response = await fetch(`${API}/admin/flatmate-reviews/${row.id}`, {
    method: 'PATCH',
    headers: auth(token),
    body: JSON.stringify({ decision, note }),
  });
  const decided = await response.json();
  expect(response.status, JSON.stringify(decided)).toBe(200);
  expect(decided.status).toBe(decision);
}

async function openTeamUp(page) {
  await page.goto(`${BASE}/flatmates`);
  const tab = page.getByRole('button', { name: /Team up/i }).first();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
}

async function openRooms(page) {
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 20_000 });
}

async function openFilters(page) {
  const toggle = page.getByRole('button', { name: /^Filters/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

test('a tenant group waiting on Ops says so, and is not given the badge it asked for', async ({ page }) => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const title = `Live pending verdict ${stamp()} in Baner`;
  const group = await createGroup(accessToken, { title, role: 'tenant', agreement: true });
  expect(group.verificationTier).toBe('tenant');

  await signedInAs(page, mobile);
  await openTeamUp(page);
  const card = page.locator(`[data-sf-id="g:${group.id}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });

  // The whole claim: declaring evidence is not the same as having it accepted.
  await expect(card.getByText('Pending Ops review', { exact: true })).toBeVisible();
  await expect(card.getByText('Tenant-verified', { exact: true })).toHaveCount(0);
});

test('an Ops approval turns the same group into Tenant-verified', async ({ page }) => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const title = `Live approved verdict ${stamp()} in Baner`;
  const group = await createGroup(accessToken, { title, role: 'tenant', agreement: true });

  await decide(group.id, 'approved');

  await signedInAs(page, mobile);
  await openTeamUp(page);
  const card = page.locator(`[data-sf-id="g:${group.id}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Tenant-verified', { exact: true })).toBeVisible();
  await expect(card.getByText('Ops-verified', { exact: true })).toBeVisible();
  await expect(card.getByText('Pending Ops review', { exact: true })).toHaveCount(0);
});

test('a rejected group stays on the board and says the review failed', async ({ page }) => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const title = `Live rejected verdict ${stamp()} in Baner`;
  const group = await createGroup(accessToken, { title, role: 'tenant', agreement: true });

  await decide(group.id, 'rejected', 'Agreement illegible');

  await signedInAs(page, mobile);
  await openTeamUp(page);
  const card = page.locator(`[data-sf-id="g:${group.id}"]`);
  // Failing verification is an unproven claim, not abuse — the post is not taken down.
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Review failed', { exact: true })).toBeVisible();
  await expect(card.getByText('Tenant-verified', { exact: true })).toHaveCount(0);
});

test('"Verified only" keeps the approved tenant group and drops the one still waiting', async ({ page }) => {
  const viewer = uniqueMobile();
  const { accessToken: approvedToken } = await apiLogin(uniqueMobile());
  const { accessToken: pendingToken } = await apiLogin(uniqueMobile());

  const approved = await createGroup(approvedToken, {
    title: `Live filter approved ${stamp()} in Baner`, role: 'tenant', agreement: true,
  });
  const pending = await createGroup(pendingToken, {
    title: `Live filter pending ${stamp()} in Baner`, role: 'tenant', agreement: true,
  });
  await decide(approved.id, 'approved');

  await signedInAs(page, viewer);
  await openTeamUp(page);
  const approvedCard = page.locator(`[data-sf-id="g:${approved.id}"]`);
  const pendingCard = page.locator(`[data-sf-id="g:${pending.id}"]`);
  // Both present first: an all-absent assertion would also pass if the board were empty.
  await expect(approvedCard).toBeVisible({ timeout: 15_000 });
  await expect(pendingCard).toBeVisible();

  await openFilters(page);
  await page.getByRole('button', { name: 'Verified only', exact: true }).click();
  await expect(approvedCard).toBeVisible();
  await expect(pendingCard).toHaveCount(0);
});

test('the same verdict drives a room card, and the room filter with it', async ({ page }) => {
  const viewer = uniqueMobile();
  const { accessToken: tenantToken } = await apiLogin(uniqueMobile());
  const { accessToken: plainToken } = await apiLogin(uniqueMobile());

  const claimed = await createRoom(tenantToken, {
    society: `Review Claim Villa ${stamp()}`, hostRole: 'tenant', agreementDeclared: true,
  });
  expect(claimed.verificationTier).toBe('tenant');
  const plain = await createRoom(plainToken, { society: `Plain Room ${stamp()}` });
  expect(plain.verificationTier).toBe('identity');

  await signedInAs(page, viewer);
  await openRooms(page);
  const claimedCard = page.locator(`[data-sf-id="r:${claimed.id}"]`);
  await expect(claimedCard).toBeVisible({ timeout: 15_000 });
  await expect(claimedCard.getByText('Pending Ops review', { exact: true })).toBeVisible();

  await decide(claimed.id, 'approved');

  await openRooms(page);
  await expect(claimedCard.getByText('Tenant-verified', { exact: true })).toBeVisible({ timeout: 15_000 });

  await openFilters(page);
  await page.getByRole('button', { name: 'Verified only', exact: true }).click();
  await expect(claimedCard).toBeVisible();
  await expect(page.locator(`[data-sf-id="r:${plain.id}"]`)).toHaveCount(0);
});

test('a post nobody had to review carries neither a badge nor a review chip', async ({ page }) => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const title = `Live no claim ${stamp()} in Baner`;
  const group = await createGroup(accessToken, { title, role: 'tenant' });
  expect(group.verificationTier).toBe('identity');

  await signedInAs(page, mobile);
  await openTeamUp(page);
  const card = page.locator(`[data-sf-id="g:${group.id}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  // Silence, not "pending": there is nothing queued, and a pending chip would invent a promise.
  await expect(card.getByText('Pending Ops review', { exact: true })).toHaveCount(0);
  await expect(card.getByText(/Tenant-verified|Owner-verified/)).toHaveCount(0);
});
