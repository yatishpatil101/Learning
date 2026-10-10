import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);
/** Let a group out of moderation, the way Ops does. A new group is `pending`, so the public feed —
 *  which is what the board reads — cannot see it, and the host cannot see their own card either. */
async function approve(groupId) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${groupId}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status).toBeLessThan(300);
}
/** A signed-in browser session and an API token for the same person. */
async function newHost(page) {
  const mobile = await signedInAsNew(page);
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}
/* Titles are unique per test: the board is one shared list, and the DB is reset per run rather than
   per file, so a fixed title would let one test's group answer another test's locator. */

const uniqueTitle = (tag) => `Live seats ${tag} ${Date.now().toString(36)} in Baner`;
// Create the group over the API.
async function hostsGroup(token, title, { seats = 3, seatsOpen = 1 } = {}) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      title, name: 'Seat Host', locality: 'Baner', rent: 45000, seats, seatsOpen,
      policy: 'any', role: 'tenant',
    }),
  });
  expect(res.status).toBe(201);
  const group = await res.json();
  track('groups', group.id, token);
  await approve(group.id);
  return group;
}

/** What the server kept — the half a reload cannot answer. */
async function serverGroup(token, groupId) {
  const res = await fetch(`${API}/me/flatmate-groups?size=100`, { headers: auth(token) });
  expect(res.status).toBe(200);
  const body = await res.json();
  const rows = body.items ?? body.content ?? body;
  const row = rows.find((g) => g.id === groupId);
  expect(row, 'the group should be on the host\'s own list').toBeTruthy();
  return row;
}

async function openDetail(page, groupId) {
  await page.goto(`${BASE}/flatmates/group/${groupId}`);
  const panel = page.getByTestId('flatmate-owner-panel');
  await expect(panel).toBeVisible({ timeout: 20_000 });
  return panel;
}

test.describe('Flatmate seat stepper (live)', () => {
  test('a group shows the seats it declared open, not the seats it has', async ({ page }) => {
    const { accessToken } = await newHost(page);
    const title = uniqueTitle('declared');
    const group = await hostsGroup(accessToken, title, { seats: 3, seatsOpen: 1 });

    await openDetail(page, group.id);

    await expect(page.getByText(/1 seat left/i).first()).toBeVisible();
    await expect(page.getByText('Your share · 3 sharing')).toBeVisible();
  });

  test('adding an open seat grows the group, and the share and sharing count follow', async ({ page }) => {
    const { accessToken } = await newHost(page);
    const title = uniqueTitle('grow');
    const group = await hostsGroup(accessToken, title, { seats: 3, seatsOpen: 1 });

    const panel = await openDetail(page, group.id);
    await expect(page.getByText('Your share · 3 sharing')).toBeVisible();
    await panel.locator('.seat-reopen-btn').click();

    await expect(page.getByText('Your share · 4 sharing')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/2 seats left/i)).toBeVisible();
    await expect(page.getByText('2 of 4 seats taken')).toBeVisible();
    await expect(page.getByText('₹11,250').first()).toBeVisible();
    const row = await serverGroup(accessToken, group.id);
    expect([row.seatsOpen, row.seatsTotal, Math.round(row.rent / row.seatsTotal)]).toEqual([2, 4, 11250]);

    await page.reload();
    await expect(page.getByText('Your share · 4 sharing')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/2 seats left/i).first()).toBeVisible();
  });

  test('removing the last open seat shrinks the group to Full and stops the stepper', async ({ page }) => {
    const { accessToken } = await newHost(page);
    const title = uniqueTitle('fill');
    const group = await hostsGroup(accessToken, title, { seats: 2, seatsOpen: 1 });

    const panel = await openDetail(page, group.id);
    await panel.locator('.seat-close-btn').click();

    // "Full" is not a field the API carries; it is `seatsOpen === 0` as the card reads it.
    await expect(page.getByText(/^Full$/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Your share · 1 sharing')).toBeVisible();
    const row = await serverGroup(accessToken, group.id);
    expect([row.seatsOpen, row.seatsTotal]).toEqual([0, 1]);
    await expect(panel.locator('.seat-close-btn')).toBeDisabled();
  });

  test('the stepper stops at the 12-person cap, and so does the server', async ({ page }) => {
    const { accessToken } = await newHost(page);
    const group = await hostsGroup(accessToken, uniqueTitle('cap'), { seats: 11, seatsOpen: 10 });

    const panel = await openDetail(page, group.id);
    await expect(panel.locator('.seat-reopen-btn')).toBeEnabled();
    await panel.locator('.seat-reopen-btn').click();

    await expect(page.getByText('Your share · 12 sharing')).toBeVisible({ timeout: 10_000 });
    await expect(panel.locator('.seat-reopen-btn')).toBeDisabled();
    await expect(page.getByTestId('group-member')).toHaveCount(1);
    await expect(page.getByTestId('group-seat-open')).toHaveCount(11);

    const res = await fetch(`${API}/flatmates/groups/${group.id}/seats`, {
      method: 'PATCH', headers: auth(accessToken), body: JSON.stringify({ seatsOpen: 12 }),
    });
    expect(res.status).toBe(400);
    expect((await serverGroup(accessToken, group.id)).seatsTotal).toBe(12);
  });

  test('seats filled off-platform show as filled seats, so the row adds up', async ({ page }) => {
    const { accessToken } = await newHost(page);
    const group = await hostsGroup(accessToken, uniqueTitle('offline'), { seats: 4, seatsOpen: 1 });

    const panel = await openDetail(page, group.id);
    await expect(page.getByText('3 of 4 seats taken')).toBeVisible();
    await expect(page.getByTestId('group-member')).toHaveCount(1);
    await expect(page.getByTestId('group-seat-filled')).toHaveCount(2);
    await expect(page.getByTestId('group-seat-open')).toHaveCount(1);

    await panel.locator('.seat-reopen-btn').click();
    await expect(page.getByText('3 of 5 seats taken')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('group-seat-filled')).toHaveCount(2);
    await expect(page.getByTestId('group-seat-open')).toHaveCount(2);
  });
  test("a seeker gets no stepper on somebody else's group", async ({ page }) => {
    const strangerMobile = uniqueMobile();
    const { accessToken: strangerToken } = await apiLogin(strangerMobile);
    const title = uniqueTitle('stranger');
    const group = await hostsGroup(strangerToken, title, { seats: 3, seatsOpen: 2 });

    await newHost(page);
    await page.goto(`${BASE}/flatmates/group/${group.id}`);
    await expect(page.getByText(/2 seats left/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('flatmate-owner-panel')).toHaveCount(0);
    await expect(page.locator('.seat-reopen-btn, .seat-close-btn')).toHaveCount(0);
  });
});
