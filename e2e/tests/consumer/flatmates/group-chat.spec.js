import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);
const tag = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

async function liveGroup() {
  const hostMobile = uniqueMobile();
  const { accessToken } = await apiLogin(hostMobile);
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({ title: `Chat ${tag()}`, name: 'Host', locality: 'Baner', rent: 30000, seats: 3, seatsOpen: 2, policy: 'any', role: 'tenant' }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const group = await res.json();
  track('groups', group.id, accessToken);
  const { accessToken: admin } = await apiLogin(ACTORS.admin);
  const mod = await fetch(`${API}/admin/flatmates/${group.id}/moderation`, {
    method: 'PATCH', headers: auth(admin), body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(mod.status, await mod.clone().text()).toBeLessThan(300);
  return { group, hostMobile };
}

async function member(groupId) {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const res = await fetch(`${API}/flatmates/groups/${groupId}/join`, {
    method: 'POST', headers: auth(accessToken), body: JSON.stringify({ share: 'solo' }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return { mobile, token: accessToken };
}

const openThread = async (token, groupId) => {
  const res = await fetch(`${API}/messages/flatmate-groups/${groupId}`, { method: 'POST', headers: auth(token), body: '{}' });
  return { status: res.status, conv: res.ok ? await res.json() : null };
};
const say = (token, convId, body) => fetch(`${API}/messages/${convId}/reply`, {
  method: 'POST', headers: auth(token), body: JSON.stringify({ body }),
});
const thread = (token, convId) => fetch(`${API}/messages/${convId}`, { headers: auth(token) });

test('host opens the group thread in Messages, sees who wrote what, and removing a member closes it to them', async ({ page }) => {
  const { group, hostMobile } = await liveGroup();
  const m = await member(group.id);
  const { conv } = await openThread(m.token, group.id);
  expect((await say(m.token, conv.id, 'Hi from the new flatmate')).status).toBe(201);

  page.on('dialog', (d) => d.accept());
  await signedInAs(page, hostMobile);
  await page.goto(`${BASE}/flatmates/group/${group.id}`);
  const link = page.getByTestId('group-chat-link');
  await expect(link.getByTestId('group-chat-unread')).toHaveText('1', { timeout: 15_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/messages\\?c=${conv.id}`));
  await expect(page.locator('.pc-head-name')).toHaveText(group.title);
  await expect(page.locator('.pc-head-sub')).toHaveText('2 members');
  await expect(page.locator('.pc-bubble.them').getByText('Hi from the new flatmate')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('chat-author').first()).not.toBeEmpty();
  await expect(page.locator('.pc-propchip')).toHaveCount(0);

  await page.locator('.pc-input').fill('Welcome aboard');
  await page.locator('.pc-input').press('Enter');
  await expect(page.locator('.pc-bubble.me').last()).toContainText('Welcome aboard');
  await expect.poll(async () => (await (await thread(m.token, conv.id)).json()).messages.map((x) => x.body))
    .toEqual(['Hi from the new flatmate', 'Welcome aboard']);

  expect((await say(m.token, conv.id, 'Thanks!')).status).toBe(201);
  await expect(page.locator('.pc-bubble.them').getByText('Thanks!')).toBeVisible({ timeout: 12_000 });

  await page.getByTestId('chat-view-group').click();
  await expect(page.getByText('2 of 3 seats taken')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('group-chat-link')).toBeVisible();
  await expect(page.getByTestId('group-chat-unread')).toHaveCount(0);
  await page.getByTestId('group-member-remove').click();
  await expect(page.getByText('removed.')).toBeVisible();
  await expect(page.getByText('1 of 3 seats taken')).toBeVisible({ timeout: 10_000 });

  expect((await thread(m.token, conv.id)).status).toBe(404);
  expect((await openThread(m.token, group.id)).status).toBe(404);
});

test('on a 360px phone a member reaches the group chat without zoom or sideways scroll; strangers get none', async ({ page, browser }) => {
  const { group } = await liveGroup();
  const m = await member(group.id);

  await page.setViewportSize({ width: 360, height: 740 });
  await signedInAs(page, m.mobile);
  await page.goto(`${BASE}/flatmates/group/${group.id}`);
  await page.getByTestId('group-chat-link').click({ timeout: 15_000 });
  const input = page.locator('.pc-input');
  await expect(input).toBeVisible({ timeout: 15_000 });
  expect(parseFloat(await input.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await input.fill('On my way');
  await input.press('Enter');
  await expect(page.locator('.pc-bubble.me').last()).toContainText('On my way');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  const stranger = await browser.newPage();
  const strangerMobile = uniqueMobile();
  await signedInAs(stranger, strangerMobile);
  await stranger.goto(`${BASE}/flatmates/group/${group.id}`);
  await expect(stranger.getByText('2 of 3 seats taken')).toBeVisible({ timeout: 15_000 });
  await expect(stranger.getByTestId('group-chat-link')).toHaveCount(0);
  await expect(stranger.getByTestId('group-member-remove')).toHaveCount(0);
  await stranger.close();
  const { accessToken } = await apiLogin(strangerMobile);
  expect((await openThread(accessToken, group.id)).status).toBe(404);
});

test('on a 360px phone the List/Map toggle circles match the search button circle', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`${BASE}/flatmates`);
  const go = page.locator('.sf-search-go').first();
  const active = page.locator('.sf-seg__btn.is-active').first();
  await expect(active).toBeVisible({ timeout: 15_000 });
  await expect(go).toBeVisible();
  const m = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const [g, a, seg] = [box('.sf-search-go'), box('.sf-seg__btn.is-active'), box('.sf-seg')];
    return { gw: g.width, gh: g.height, aw: a.width, ah: a.height, inset: a.top - seg.top };
  });
  expect(Math.round(m.aw)).toBe(Math.round(m.gw));
  expect(Math.round(m.ah)).toBe(Math.round(m.gh));
  expect(Math.round(m.inset)).toBe(4);
  const paint = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(await paint(active)).toBe(await paint(go));
});
