import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function createPost(token, { locality = 'Baner', name = 'Moderation Tester', note = 'Moderation coverage' } = {}) {
  const res = await fetch(`${API}/flatmates/posts`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      name,
      gender: 'female',
      age: 26,
      occupation: 'Engineer',
      budget: 18000,
      localities: [locality],
      moveIn: '2026-12-01',
      flatPref: 'women',
      roomPref: 'private',
      tags: ['Vegetarian'],
      note,
    }),
  });
  return res;
}

async function created(res, token, kind) {
  const body = await res.text();
  expect(res.status, body).toBe(201);
  const row = JSON.parse(body);
  track(kind, row.id, token);
  return row;
}

test('a new seeker post is live at once and waits on the Ops re-check board', async () => {
  const { accessToken } = await apiLogin(uniqueMobile());
  const name = `Live ${Date.now().toString(36)}`;
  const post = await created(await createPost(accessToken, { name }), accessToken, 'posts');
  expect(post.modStatus).toBe('live');

  const feed = await (await fetch(`${API}/flatmates/feed?tab=team-up&size=100`)).json();
  expect((feed.content ?? feed).some((r) => r.id === post.id), 'a stranger sees it on the public feed').toBe(true);

  const { accessToken: admin } = await apiLogin(ACTORS.admin);
  const board = await (await fetch(`${API}/admin/flatmates/moderation?kind=post&modStatus=recheck&size=100`, {
    headers: auth(admin),
  })).json();
  const row = board.content.find((r) => r.id === post.id);
  expect(row?.recheckReason, 'Ops still reads it, after the fact').toBe('new post');
});

  // Positive first: the public feed is non-empty (other approved posts exist in the seed).
test('a phone number in a seeker post is refused, not published', async () => {
  const { accessToken } = await apiLogin(uniqueMobile());
  const res = await createPost(accessToken, { note: 'Call me on 98200 11223' });
  expect(res.status).toBe(422);
});

test('a group with a flat is still held until a moderator publishes it', async ({ page }) => {
  const { accessToken } = await apiLogin(uniqueMobile());
  const title = `Held flat ${Date.now().toString(36)}`;
  const group = await created(await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({ title, locality: 'Kothrud', policy: 'any', rent: 40000, seats: 3, seatsOpen: 1, name: 'Host', tags: [] }),
  }), accessToken, 'groups');
  expect(group.modStatus).toBe('pending');

  const feed = await (await fetch(`${API}/flatmates/feed?tab=team-up&locality=Kothrud&size=100`)).json();
  expect(feed.content.some((g) => g.id === group.id), 'a pending group must not appear on the public feed').toBe(false);

  await approve(group.id);
  // Confirmed as a stranger: the author would see the row in the always-present "Your request"
  // banner instead of as a card, so a stranger's card is the stronger claim.
  const strangerMobile = uniqueMobile();
  await apiLogin(strangerMobile);
  await signedInAs(page, strangerMobile);
  await page.goto(`${BASE}/flatmates/group/${group.id}`);
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });
});

async function approve(id) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e moderation spec' }),
  });
  expect(res.status, `approve ${id}: ${await res.clone().text()}`).toBeLessThan(300);
}
