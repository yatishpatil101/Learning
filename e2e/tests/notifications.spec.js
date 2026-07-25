import { test, expect } from '../fixtures/base.js';

// Desktop coverage for the consumer Notifications page (/notifications).
// Behaviour verified from: pages/consumer/Notifications.jsx (SEED set + derive),
// lib/store/notifications.js (pnNotifications:<mobile>, seed-once, mark/dismiss),
// App.jsx (/notifications behind ProtectedRoute), RouteGuards.jsx (-> /signin),
// and en/common.json "notifications" labels.
//
// property-alerts.spec.js covers the dashboard Alerts tab (saved searches); this
// spec goes deeper on the /notifications inbox surface: list, mark-all-read,
// dismiss/clear, category filter, the preferences link and the empty state.

const BUYER_MOBILE = '9876500001';

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

// Force an empty inbox: an existing (empty) key makes seedNotifsIfEmpty a no-op.
async function seedEmptyNotifs(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem(`pnNotifications:${mobile}`, JSON.stringify([]));
  }, BUYER_MOBILE);
}

test.describe('Notifications — desktop', () => {
  test('guards /notifications: an unauthenticated visitor is redirected to /signin', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
    await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0);
  });

  test('renders the seeded inbox: header, filters, grouped items', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/notifications');

    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    // The default SEED has 8 notifications, 4 of them unread.
    await expect(page.locator('.notif')).toHaveCount(8);
    await expect(page.locator('p', { hasText: 'unread updates' })).toContainText('4');

    // Filter chips from the FILTERS list.
    await expect(page.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Matches' })).toBeVisible();

    // Grouped by Today / Earlier, with real seed copy.
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Earlier' })).toBeVisible();
    await expect(page.getByText('3 new properties match your search')).toBeVisible();
    await expect(page.getByText('Welcome to PuneNest!')).toBeVisible();
  });

  test('mark-all-read clears the unread affordances', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/notifications');

    const markAll = page.getByRole('button', { name: 'Mark all read' });
    await expect(markAll).toBeVisible();
    await markAll.click();

    // With nothing unread the button is removed and no unread rows remain.
    await expect(markAll).toHaveCount(0);
    await expect(page.locator('.notif.unread')).toHaveCount(0);
  });

  test('dismiss removes a single notification from the inbox', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/notifications');

    await expect(page.locator('.notif')).toHaveCount(8);
    await page.getByRole('button', { name: 'Dismiss' }).first().click();
    await expect(page.locator('.notif')).toHaveCount(7);
  });

  test('category filter narrows the list to matching types', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/notifications');

    await page.getByRole('button', { name: 'New Matches' }).click();
    // Two match-type notifications are seeded (n-match-baner, n-match-balewadi).
    await expect(page.locator('.notif')).toHaveCount(2);
    // An enquiry notification is filtered out.
    await expect(page.getByText('Priya Kulkarni sent an enquiry')).toHaveCount(0);
  });

  test('exposes the notification-preferences link', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/notifications');

    await expect(page.getByRole('link', { name: /Manage notification preferences/ })).toBeVisible();
  });

  test('shows the empty state when there are no notifications', async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
    await seedEmptyNotifs(page);
    await page.goto('/notifications');

    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByText("You're all caught up — no notifications yet.")).toBeVisible();
    await expect(page.locator('.notif')).toHaveCount(0);
  });

  test('loads the notifications page with no real console errors', async ({ page, login, consoleErrors }) => {
    await login.asBuyer();
    await seedConsent(page);
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.locator('.notif').first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
