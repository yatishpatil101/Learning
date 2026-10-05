import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { detailCta } from '../../../helpers/app.js';

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

  await card.getByRole('link', { name: group.title }).click();
  await expect(page).toHaveURL(new RegExp(`/flatmates/group/${group.id}$`));
  const joinBtn = detailCta(page, /Join group/i);
  await expect(joinBtn).toBeVisible({ timeout: 15_000 });
  await joinBtn.click();

  await expect(page.getByText(/^\s*(You're in|Requested)\s*$/).filter({ visible: true }).first()).toBeVisible({ timeout: 5_000 });
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

test('a signed-out user is routed to sign-in when joining a group', async ({ page }) => {
  await page.goto(`${BASE}/flatmates`);
  await page.getByRole('button', { name: /Team up/i }).first().click();
  const card = page.locator('.sf-card[data-sf-id^="g:"]').filter({ hasText: /seats? left/ }).first();
  await card.waitFor({ timeout: 15_000 });
  await card.locator('h3 a').click();
  await expect(page).toHaveURL(/\/flatmates\/group\//);

  const joinBtn = detailCta(page, /Join group|Request to join/i);
  await expect(joinBtn).toBeVisible({ timeout: 15_000 });
  await joinBtn.click();

  await expect(page).toHaveURL(/\/signin/, { timeout: 5_000 });
});
