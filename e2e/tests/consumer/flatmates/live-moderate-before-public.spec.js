import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Moderate-before-public against a real server (tech-debt D72).
 *
 * ## What this proves
 *
 * 1. A freshly created post starts at `modStatus = 'pending'` on the server, the author can see
 *    it on their own caller-scoped list (`/me/flatmate-posts`), and the board tells them "in
 *    review" — not "live".
 * 2. A stranger browsing the public feed (`/flatmates/feed?tab=team-up`) does NOT see the
 *    pending post, because the feed query is a whitelist (`in ('live','approved')`), not a
 *    blacklist. The positive-first pattern matters: the spec first proves the board is non-empty
 *    (other cards render) and that the author's row exists (the API shows it to its author),
 *    so the stranger's absence is a statement about the filter, not about an empty page.
 * 3. Once a moderator approves the post, it reaches the public board unchanged — the gate is a
 *    gate, not a wall.
 *
 * ## Why a seeker post rather than a room or group
 *
 * `POST /flatmates/posts` is the only one of the three doors that writes to the moderation
 * queue without needing Ops approval or a property split first, so it isolates the whitelist
 * from any other gating layer. The whitelist is the same JPQL on all three repositories.
 *
 * ## What is deliberately NOT asserted
 *
 * - The "in review" badge appearance on the flatmates page itself. `live-my-listings.spec.js`
 *   already proves "Your request · in review" renders for a freshly posted request, and
 *   duplicating it here would be asserting a label rather than the moderation contract.
 * - Edit/Delete while pending. The mock twin tested those buttons, but they are UI controls
 *   that exist on the card unconditionally — whether they work while pending is a question
 *   about the delete endpoint, not about the whitelist this spec is about.
 */

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

  // Browser confirmation: a stranger sees the card on the Team up tab. Browsing as the
  // author would show the row in the "Your request" banner rather than as a card, and the
  // banner is always there — so a stranger's card is the stronger claim.
  const strangerMobile = uniqueMobile();
  await apiLogin(strangerMobile);
  await signedInAs(page, strangerMobile);
  await page.goto(`${BASE}/flatmates`);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Team up/i }).first().click();

  const card = page.locator('.sf-card', { hasText: post.name }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
});
