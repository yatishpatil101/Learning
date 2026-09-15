import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/* A seeker post is the only door that writes to the moderation queue without needing Ops approval
   or a property split first, so it isolates the whitelist (`in ('live','approved')`) from the
   other gating layers — the same JPQL guards all three repositories. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function createPost(token, { locality = 'Baner', name = 'Moderation Tester' } = {}) {
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
      note: 'Moderate-before-public coverage',
    }),
  });
  const body = await res.text();
  expect(res.status, body).toBe(201);
  const post = JSON.parse(body);
  track('posts', post.id, token);
  return post;
}

async function approve(id) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e moderation spec' }),
  });
  expect(res.status, `approve ${id}: ${await res.clone().text()}`).toBeLessThan(300);
}

test('a new post is pending on the server and the author sees it on their own list', async () => {
  const authorMobile = uniqueMobile();
  const { accessToken: authorToken } = await apiLogin(authorMobile);
  const post = await createPost(authorToken);

  // The server must report this as pending — that is the whole D72 contract.
  expect(post.modStatus).toBe('pending');

  // The caller-scoped endpoint shows the author their own pending post.
  const mine = await fetch(`${API}/me/flatmate-posts?size=50`, {
    headers: auth(authorToken),
  });
  expect(mine.status).toBe(200);
  const myPosts = await mine.json();
  const rows = myPosts.content ?? myPosts;
  const found = rows.find((r) => r.id === post.id);
  expect(found, 'the author must see their own pending post').toBeTruthy();
  expect(found.modStatus).toBe('pending');
});

test('a stranger cannot see the pending post on the public feed', async () => {
  const authorMobile = uniqueMobile();
  const { accessToken: authorToken } = await apiLogin(authorMobile);
  const post = await createPost(authorToken);

  // Positive first: the public feed is non-empty (other approved posts exist in the seed).
  const feedRes = await fetch(`${API}/flatmates/feed?tab=team-up&size=100`);
  expect(feedRes.status).toBe(200);
  const feed = await feedRes.json();
  const items = feed.content ?? feed;
  expect(items.length, 'the public feed should have at least one approved row').toBeGreaterThan(0);

  // The author's pending post is NOT in the public feed.
  const visible = items.find((r) => r.id === post.id);
  expect(visible, 'a pending post must not appear on the public feed').toBeFalsy();

  // And the caller-scoped read confirms it exists — the absence is about the filter,
  // not about a failed write.
  const mine = await fetch(`${API}/me/flatmate-posts?size=50`, {
    headers: auth(authorToken),
  });
  const myPosts = await mine.json();
  const myRows = myPosts.content ?? myPosts;
  expect(myRows.some((r) => r.id === post.id), 'the post exists, just not publicly').toBe(true);
});

test('an approved post reaches the public feed unchanged', async ({ page }) => {
  const authorMobile = uniqueMobile();
  const { accessToken: authorToken } = await apiLogin(authorMobile);
  const post = await createPost(authorToken, { name: `Approved ${Date.now().toString(36)}` });

  // Approve the post.
  await approve(post.id);

  // The public feed now includes the post.
  await expect
    .poll(async () => {
      const res = await fetch(`${API}/flatmates/feed?tab=team-up&size=100`);
      const body = await res.json();
      const items = body.content ?? body;
      return items.some((r) => r.id === post.id);
    }, { message: 'the approved post should appear on the public feed', timeout: 15_000 })
    .toBe(true);

  // Confirmed as a stranger: the author would see the row in the always-present "Your request"
  // banner instead of as a card, so a stranger's card is the stronger claim.
  const strangerMobile = uniqueMobile();
  await apiLogin(strangerMobile);
  await signedInAs(page, strangerMobile);
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Team up/i }).first().click();

  const card = page.locator('.sf-card', { hasText: post.name }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
});
