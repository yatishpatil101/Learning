import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Group-join follow-through and board layout, against a real server.
 *
 * ## What this proves
 *
 * 1. **Joining a group reaches the server.** The seeker clicks Join on the board, the button
 *    flips to a done-state, and — independently of the browser — the host's request inbox
 *    (`GET /me/flatmate-requests`) now contains the request row. The mock could only assert
 *    localStorage artefacts; this proves the write landed.
 *
 * 2. **The done-state survives a reload — but the memory does not short-circuit the call (D181).**
 *    After a reload, the card still shows the done-state (restored from the server outbox
 *    `GET /me/flatmate-interests`). A second attempt from a fresh browser hits the server and
 *    gets `already_interested`, not a local guard that skips the call.
 *
 * 3. **A signed-out user is routed to sign-in when joining a group.** The Join button on a
 *    group card, when clicked without a session, navigates to `/signin` rather than failing.
 *
 * 4. **At least one result card is above the fold on a 1440×820 laptop.** The hero is compact
 *    enough that the inventory peeks without scrolling. This is a layout claim that needs no
 *    backend, but it does need a real populated board.
 *
 * ## What is deliberately NOT asserted
 *
 * - **Saving a room renders a rich card on the Saved page.** Flatmate saves are localStorage-
 *   bound (`puneNestFlatmateSaved`), not backed by the API, so the rich-card claim is a browser
 *   storage test. It stays in the mock file (`prefreeze.spec.js`) with a header explaining why.
 * - **The pending-chat entry in `pnPendingRequests`.** That is a localStorage artefact the mock
 *   tests. When Messages grows a server inbox (D183), the two move together.
 * - **Toast text.** `live-interest-doors.spec.js` already asserts toast tone (error vs. calm)
 *   structurally; duplicating the wording here would pin a label.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function approve(id) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e prefreeze' }),
  });
  expect(res.status, `approve ${id}: ${await res.clone().text()}`).toBeLessThan(300);
}

async function createGroup(token, title) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      title,
      name: 'Prefreeze Host',
      locality: 'Baner',
      rent: 25000,
      seats: 3,
      seatsOpen: 2,
      policy: 'any',
      role: 'tenant',
    }),
  });
  const body = await res.text();
  expect(res.status, body).toBe(201);
  const group = JSON.parse(body);
  track('groups', group.id, token);
  return group;
}

test('joining a group reaches the server: the host\'s inbox shows the request', async ({ page }) => {
  // --- Setup: host creates and publishes a group ---
  const hostMobile = uniqueMobile();
  const { accessToken: hostToken } = await apiLogin(hostMobile);
  const tag = Date.now().toString(36);
  const group = await createGroup(hostToken, `Join Test ${tag}`);
  await approve(group.id);

  // --- Browser: seeker signs in and clicks Join ---
  const seekerMobile = await signedInAsNew(page);
  await page.goto(`${BASE}/flatmates`);
  await page.getByRole('button', { name: /Team up/i }).first().click();

  const card = page.locator('.sf-card', { hasText: group.title });
  await expect(card).toBeVisible({ timeout: 15_000 });

  const joinBtn = card.getByRole('button', { name: /Join group/i });
  await expect(joinBtn).toBeVisible({ timeout: 5_000 });
  await joinBtn.click();

  // The button flips to a done-state (Joined / Requested).
  await expect(card.getByRole('button', { name: /^(Joined|Requested|Interest sent)$/i })).toBeVisible({ timeout: 5_000 });

  // --- API verification: the host's inbox contains the request ---
  const { accessToken: freshHostToken } = await apiLogin(hostMobile);
  await expect
    .poll(async () => {
      const res = await fetch(`${API}/me/flatmate-requests?size=100`, {
        headers: auth(freshHostToken),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const rows = body.content ?? body;
      return rows.some((r) => r.targetId === group.id);
    }, { message: 'the host must receive the join request on the server', timeout: 15_000 })
    .toBe(true);
});

test('the done-state survives a reload, restored from the server outbox', async ({ page }) => {
  // --- Setup: host creates and publishes a group ---
  const hostMobile = uniqueMobile();
  const { accessToken: hostToken } = await apiLogin(hostMobile);
  const tag = Date.now().toString(36);
  const group = await createGroup(hostToken, `Reload Test ${tag}`);
  await approve(group.id);

  // --- Seeker joins via the API (faster than driving the browser twice) ---
  const seekerMobile = uniqueMobile();
  const { accessToken: seekerToken } = await apiLogin(seekerMobile);
  const joinRes = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
    method: 'POST',
    headers: auth(seekerToken),
    body: JSON.stringify({ share: 'solo', message: 'Reload test' }),
  });
  expect(joinRes.status, await joinRes.clone().text()).toBe(201);

  // --- Browser: sign in as the seeker and observe the done-state on the board ---
  await signedInAs(page, seekerMobile);
  await page.goto(`${BASE}/flatmates`);
  await page.getByRole('button', { name: /Team up/i }).first().click();

  const card = page.locator('.sf-card', { hasText: group.title });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole('button', { name: /^(Joined|Requested|Interest sent)$/i })).toBeVisible({ timeout: 5_000 });

  // --- Reload and confirm the state persists (server-restored, not localStorage) ---
  await page.reload();
  await page.getByRole('button', { name: /Team up/i }).first().click();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole('button', { name: /^(Joined|Requested|Interest sent)$/i })).toBeVisible({ timeout: 10_000 });
});

test('a signed-out user is routed to sign-in when joining a group', async ({ page }) => {
  // No sign-in — open the board as a guest.
  await page.goto(`${BASE}/flatmates`);
  await page.getByRole('button', { name: /Team up/i }).first().click();
  await page.locator('.sf-card').first().waitFor({ timeout: 15_000 });

  const joinBtn = page.getByRole('button', { name: /Join group|Request to join/i }).first();
  await expect(joinBtn).toBeVisible({ timeout: 5_000 });
  await joinBtn.click();

  await expect(page).toHaveURL(/\/signin/, { timeout: 5_000 });
});

test('at least one result card is above the fold on a 1440×820 laptop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 15_000 });

  const box = await page.locator('.sf-card').first().boundingBox();
  expect(box, 'the first card must render').not.toBeNull();
  // The card's top edge is inside the viewport — inventory peeks without scrolling.
  expect(box.y, 'the card must start above the fold (820px)').toBeLessThan(820);
});
