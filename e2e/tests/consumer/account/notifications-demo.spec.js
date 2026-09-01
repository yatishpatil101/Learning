import { test, expect } from '../../../fixtures/base.js';
import { USERS } from '../../../helpers/seed.js';

/* /notifications in the demo build — the inbox the mock provider owns.
 *
 * The eight demo rows used to be held by `Notifications.jsx`, which wrote them to
 * `pnNotifications:<mobile>` from a `useState` initialiser behind an
 * `isHttpDomain('notification')` check. They now live in
 * `services/providers/mock/notificationProvider.js` and are written on its first
 * `listNotifications`, so the http provider has no route to them at all — that half is
 * asserted by `live-notifications` ("the demo seed reaches neither the screen nor storage").
 *
 * This is the other half. Moving the seed changed *when* it runs: from a synchronous render-time
 * write to an awaited provider read. That is exactly the kind of change that leaves a demo build
 * with a permanently empty inbox while every live test stays green, so the demo inbox needs a
 * test of its own rather than being assumed.
 *
 * The rows are asserted by their rendered copy, not by reading localStorage back: a seed that is
 * written and never rendered is a broken demo, and a spec that reads back the key it expects the
 * app to have written would pass on exactly that failure.
 */

const USER = USERS.buyer;

async function openInbox(page) {
  await page.addInitScript((user) => {
    localStorage.setItem('puneNestUser', JSON.stringify(user));
    localStorage.setItem('puneNestUsers', JSON.stringify([user]));
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  }, USER);
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 20_000 });
}

test.describe('Notifications — demo inbox', () => {
  test('the demo build shows the seeded inbox rather than an empty one', async ({ page, consoleErrors }) => {
    await openInbox(page);

    // The exact size of the seed, not "some rows": a provider that seeded a subset, or that
    // seeded twice, is a defect this would otherwise render invisible.
    await expect(page.locator('.notif')).toHaveCount(8);
    await expect(page.getByText('3 new properties match your search')).toBeVisible();
    await expect(page.getByText('Welcome to PuneNest!')).toBeVisible();

    // The empty state is what a seed that stopped running looks like, so it is named directly.
    await expect(page.getByText("You're all caught up — no notifications yet.")).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });

  test('a reload does not duplicate the seed', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('.notif')).toHaveCount(8);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 20_000 });
    // `seedNotifsIfEmpty` no-ops once the key exists. Seeding on every provider read instead of
    // once per user would show up here as 16, and nowhere else.
    await expect(page.locator('.notif')).toHaveCount(8);
  });

  test('the category chips filter the seeded rows', async ({ page }) => {
    await openInbox(page);

    await page.getByRole('button', { name: 'New Matches' }).click();
    // Two `match` rows are seeded; the assertion is their count, because "at least one row is
    // visible" is also true of a filter that was never applied.
    await expect(page.locator('.notif')).toHaveCount(2);
    await expect(page.getByText('Priya Kulkarni sent an enquiry')).toHaveCount(0);
  });
});
