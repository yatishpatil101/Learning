import { test, expect } from '@playwright/test';
import { API, apiLogin, signIn, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function createPost(token, locality = 'Baner') {
  const response = await fetch(`${API}/flatmates/posts`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      name: 'Dashboard Seeker',
      gender: 'female',
      age: 26,
      occupation: 'Engineer',
      budget: 18000,
      localities: [locality],
      moveIn: '2026-12-01',
      flatPref: 'women',
      roomPref: 'private',
      tags: ['Vegetarian'],
      note: 'Dashboard coverage',
    }),
  });
  expect(response.status).toBe(201);
  const post = await response.json();
  track('posts', post.id, token);
  return post;
}

async function publish(postId) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const response = await fetch(`${API}/admin/flatmates/${postId}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e publication' }),
  });
  expect(response.status).toBeLessThan(300);
}

test.describe('LIVE: caller-scoped flatmate state', () => {
  test('the dashboard reads the caller-owned post from /me rather than browser storage', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    const post = await createPost(accessToken);

    await signIn(page, mobile);
    const myPosts = page.waitForResponse((response) =>
      response.url().includes('/api/me/flatmate-posts') && response.request().method() === 'GET' && response.status() === 200,
    );
    await page.goto('/dashboard');
    await myPosts;

    await page.getByRole('complementary').getByRole('button', { name: 'My Properties' }).click();
    await expect(page.getByText(`Looking to share — ${post.localities[0]}`, { exact: true })).toBeVisible();

    const ownRequest = page.waitForResponse((response) =>
      response.url().includes('/api/me/flatmate-posts') && response.request().method() === 'GET' && response.status() === 200,
    );
    await page.goto('/flatmates?view=team-up');
    await ownRequest;
    await expect(page.getByText('Your request · in review', { exact: true })).toBeVisible();
    await expect(page.getByText('Dashboard Seeker', { exact: false })).toBeVisible();
  });

  test('a sent interest appears only in the requesters outbox', async () => {
    const host = await apiLogin(uniqueMobile());
    const seeker = await apiLogin(uniqueMobile());
    const post = await createPost(host.accessToken, 'Kothrud');
    await publish(post.id);

    const send = await fetch(`${API}/flatmates/posts/${post.id}/interest`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo', message: 'Please contact me.' }),
    });
    expect(send.status).toBe(201);

    const seekerOutbox = await (await fetch(`${API}/me/flatmate-interests`, { headers: auth(seeker.accessToken) })).json();
    const hostOutbox = await (await fetch(`${API}/me/flatmate-interests`, { headers: auth(host.accessToken) })).json();
    expect(seekerOutbox.content).toContainEqual(expect.objectContaining({ targetId: post.id }));
    expect(hostOutbox.content.some((interest) => interest.targetId === post.id)).toBe(false);
  });
});
