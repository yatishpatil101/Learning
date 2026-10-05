import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

const track = flatmateCleanup(test);

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function hostsPost(token, locality) {
  const res = await fetch(`${API}/flatmates/posts`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      name: 'Expiry Seeker',
      gender: 'female',
      age: 26,
      occupation: 'Engineer',
      budget: 18000,
      localities: [locality],
      moveIn: '2026-12-01',
      flatPref: 'women',
      roomPref: 'private',
      tags: ['Vegetarian'],
      note: 'Expiry coverage',
    }),
  });
  expect(res.status, 'seeding a seeker post').toBe(201);
  const post = await res.json();
  track('posts', post.id, token);
  return post;
}

test.describe('LIVE: flatmate post expiry', () => {
  test('an expired post shows as Expired on the dashboard and Renew puts it back', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken } = await apiLogin(mobile);
    await hostsPost(accessToken, 'Baner');
    await signedInAs(page, mobile);

    let renewed = false;
    await page.route(/\/me\/flatmate-posts(\?|$)/, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      if (!renewed) body.content = body.content.map((p) => ({ ...p, modStatus: 'expired' }));
      await route.fulfill({ response: res, json: body });
    });

    await page.goto('/dashboard#listings');
    const card = page.locator('div.rounded-xl', { hasText: 'Looking to share — Baner' }).last();
    await expect(card.getByText('Expired', { exact: true })).toBeVisible({ timeout: 20_000 });

    const renew = page.waitForResponse((r) => r.url().includes('/renew') && r.request().method() === 'POST');
    await card.getByRole('button', { name: 'Renew for 30 days' }).click();
    renewed = true;
    expect((await renew).status(), 'the server should accept the owner renewing').toBe(204);

    await expect(page.getByText(/back on the board for 30 days/)).toBeVisible();
    await expect(card.getByText('Expired', { exact: true })).toBeHidden();
  });
});
