import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);
const tag = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

async function liveGroup(policy) {
  const { accessToken } = await apiLogin(uniqueMobile());
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({ title: `Cap ${policy} ${tag()}`, name: 'Host', locality: 'Baner', rent: 30000, seats: 3, seatsOpen: 2, policy, role: 'tenant' }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const group = await res.json();
  track('groups', group.id, accessToken);
  const { accessToken: admin } = await apiLogin(ACTORS.admin);
  const mod = await fetch(`${API}/admin/flatmates/${group.id}/moderation`, {
    method: 'PATCH', headers: auth(admin), body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(mod.status, await mod.clone().text()).toBeLessThan(300);
  return group;
}

async function join(token, groupId, expected) {
  const res = await fetch(`${API}/flatmates/groups/${groupId}/join`, {
    method: 'POST', headers: auth(token), body: JSON.stringify({ share: 'solo' }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  expect((await res.json()).status).toBe(expected);
}

test('a third group is refused; cancel and leave free the slot and the seat', async ({ page }) => {
  const [open, gated, third] = [await liveGroup('any'), await liveGroup('women'), await liveGroup('any')];
  const seeker = uniqueMobile();
  const { accessToken } = await apiLogin(seeker);
  await join(accessToken, open.id, 'accepted');
  await join(accessToken, gated.id, 'pending');

  page.on('dialog', (d) => d.accept());
  await signedInAs(page, seeker);

  await page.goto(`${BASE}/flatmates/group/${third.id}`);
  await page.getByRole('button', { name: 'Join group' }).click();
  await expect(page.getByText(/You can be in 2 groups at a time/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Join group' })).toBeVisible();

  await page.goto(`${BASE}/dashboard#groups`);
  const panel = page.getByTestId('my-flatmate-groups');
  const row = (g) => panel.locator('.group', { hasText: g.title });
  await expect(row(open)).toContainText('Baner · In', { timeout: 15_000 });
  await expect(row(gated)).toContainText('Baner · Waiting');
  await row(gated).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Request cancelled.')).toBeVisible();
  await expect(row(gated)).toHaveCount(0);

  await row(open).getByRole('link', { name: 'View' }).click();
  await expect(page).toHaveURL(new RegExp(`/flatmates/group/${open.id}`));
  await expect(page.getByText('2 of 3 seats taken')).toBeVisible({ timeout: 15_000 });
  const membership = page.getByTestId('group-membership').first();
  await expect(membership).toContainText("You're in");
  await membership.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByText(`You left ${open.title}.`)).toBeVisible();
  await expect(page.getByText('1 of 3 seats taken')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Join group' }).first()).toBeVisible();

  await page.goto(`${BASE}/flatmates/group/${third.id}`);
  await page.getByRole('button', { name: 'Join group' }).click();
  await expect(page.getByTestId('group-membership').first()).toContainText("You're in", { timeout: 10_000 });
});

test('on a 360px phone the member bar fits: You\'re in and Leave, no sideways scroll', async ({ page }) => {
  const group = await liveGroup('any');
  const seeker = uniqueMobile();
  const { accessToken } = await apiLogin(seeker);
  await join(accessToken, group.id, 'accepted');

  await page.setViewportSize({ width: 360, height: 740 });
  await signedInAs(page, seeker);
  await page.goto(`${BASE}/flatmates/group/${group.id}`);
  const bar = page.locator('.fm-sticky');
  await expect(bar.getByText("You're in")).toBeVisible({ timeout: 15_000 });
  const leave = bar.getByRole('button', { name: 'Leave' });
  await expect(leave).toBeVisible();
  const box = await leave.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('the dashboard invites a person with no groups to find one', async ({ page }) => {
  await signedInAs(page, uniqueMobile());
  await page.goto(`${BASE}/dashboard#groups`);
  const panel = page.getByTestId('my-flatmate-groups');
  await expect(panel).toContainText("You're not in any group yet.", { timeout: 15_000 });
  await panel.getByRole('link', { name: 'Find a group' }).click();
  await expect(page).toHaveURL(/\/flatmates$/);
});
