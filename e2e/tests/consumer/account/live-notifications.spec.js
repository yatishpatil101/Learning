import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

/*
 * The retired mock suite seeded `dzNotifications:<mobile>` and then asserted the
 * same local array after mark-all and dismiss. This file crosses the real boundary:
 * the page acts through `/notifications`, then a second API client reads the inbox
 * back outside the browser. The seeded buyer is deliberately read for the fixtures
 * the database owns; destructive assertions derive their subject from the current
 * server response rather than assuming a fixed count or order.
 */
/* The demo inbox these ids and titles came from, named here so the live build can be checked
   against it. It used to live in `providers/mock/notificationProvider.js` and this list was kept in
   sync with that file by hand; D256 deleted the provider, so the list is now the only copy and its
   counterpart is the database seed. Nothing keeps the two in step automatically — if the seed
   changes, the honest failure is this list going stale, not a silent hole in the check. */
const SEED_IDS = [
  'n-match-baner', 'n-flatmate-hinjawadi', 'n-enquiry-priya', 'n-price-kp',
  'n-visit-wakad', 'n-match-balewadi', 'n-enquiry-viewed', 'n-system-welcome',
];
const SEED_TITLES = [
  '3 new properties match your search',
  'Welcome to Draazy!',
  'Price dropped on a saved property',
];

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

async function inbox(mobile) {
  const response = await fetch(`${API}/notifications?size=100`, {
    headers: await authHeaders(mobile),
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const page = JSON.parse(body);
  expect(Array.isArray(page.content), 'the notification contract returns a page envelope').toBe(true);
  return page.content;
}

async function openInbox(page, mobile) {
  await seedConsent(page);
  await signedInAs(page, mobile);
  const loaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/api/notifications') &&
    response.request().method() === 'GET' &&
    response.status() === 200,
  );
  await page.goto('/notifications');
  await loaded;
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
}

test.describe('Notifications — live API', () => {
  test('guards /notifications: an unauthenticated visitor is redirected to /signin', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
    await expect(page.getByRole('button', { name: /Send OTP|Continue|Sign in/i }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toHaveCount(0);
  });

  test('renders server-owned inbox rows and filters their mapped categories', async ({ page }) => {
    const before = await inbox(ACTORS.buyer);
    const unread = before.find((row) => !row.read);
    const enquiry = before.find((row) => row.type.startsWith('contact.'));
    const match = before.find((row) => row.type === 'saved.search.match');

    expect(unread, 'the fixture must include an unread server notification').toBeTruthy();
    expect(enquiry, 'the fixture must include a contact notification').toBeTruthy();
    expect(match, 'the fixture must include a saved-search match').toBeTruthy();

    await openInbox(page, ACTORS.buyer);

    const unreadCard = page.locator('.notif.unread', { hasText: unread.title });
    await expect(unreadCard).toBeVisible();
    await expect(page.getByText(match.title)).toBeVisible();

    await page.getByRole('button', { name: 'New Matches' }).click();
    await expect(page.locator('.notif')).not.toHaveCount(0);
    await expect(page.getByText(match.title)).toBeVisible();
    await expect(page.getByText(enquiry.title)).toHaveCount(0);
  });

  test('exposes the notification-preferences link', async ({ page }) => {
    await openInbox(page, ACTORS.buyer);
    await expect(page.getByRole('link', { name: /Manage notification preferences/ })).toBeVisible();
  });

  test('shows the empty state for an account with no server notifications', async ({ page }) => {
    const mobile = uniqueMobile();
    await openInbox(page, mobile);

    expect(await inbox(mobile)).toHaveLength(0);
    await expect(page.getByText("You're all caught up — no notifications yet.")).toBeVisible();
    await expect(page.locator('.notif')).toHaveCount(0);
  });

  /*
   * The demo inbox cannot reach a live account.
   *
   * Eight fabricated rows used to be held by `Notifications.jsx` and written to
   * `dzNotifications:<mobile>` behind an `isHttpDomain('notification')` check. The check was
   * correct, but it was a condition a page had to keep getting right; the seed now lives in
   * `providers/mock/notificationProvider.js`, so the http provider has no route to it at all.
   *
   * This asserts the outcome rather than the mechanism, in the two places it would show. The
   * account is brand new, so the server's own answer is the empty set — read here from outside the
   * browser — and any row on screen would therefore have been invented by the client. The storage
   * key is then checked by id, because a seed that was written and then filtered out of the render
   * is still a row this browser would show the next time it loaded offline.
   */
  test('the demo seed reaches neither the screen nor storage on a live build', async ({ page }) => {
    const mobile = uniqueMobile();
    await openInbox(page, mobile);

    expect(await inbox(mobile), 'a new account starts with an empty server inbox').toHaveLength(0);
    await expect(page.locator('.notif')).toHaveCount(0);
    for (const title of SEED_TITLES) {
      await expect(page.getByText(title), `"${title}" is demo content and must not render`).toHaveCount(0);
    }

    const stored = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('dzNotifications:'));
      return key ? localStorage.getItem(key) : null;
    });
    const ids = stored ? JSON.parse(stored).map((row) => String(row.id)) : [];
    expect(ids.filter((id) => SEED_IDS.includes(id)), 'the demo seed was written to a live inbox').toEqual([]);
  });

  test('loads the notifications page with no console errors', async ({ page, consoleErrors }) => {
    await openInbox(page, ACTORS.buyer);
    await expect(page.locator('.notif').first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  // Destructive tests — mutate ACTORS.buyer state; these run last so earlier baseline-dependent tests pass first.
  test('mark all read reaches the server as well as removing the unread affordance', async ({ page }) => {
    const before = await inbox(ACTORS.buyer);
    expect(before.some((row) => !row.read), 'the fixture must begin with an unread notification').toBe(true);

    await openInbox(page, ACTORS.buyer);
    const markAll = page.getByRole('button', { name: 'Mark all read' });
    await expect(markAll).toBeVisible();

    const marked = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/api/notifications/read') &&
      response.request().method() === 'POST' &&
      response.status() === 204,
    );
    await markAll.click();
    await marked;

    await expect(markAll).toHaveCount(0);
    await expect(page.locator('.notif.unread')).toHaveCount(0);
    expect((await inbox(ACTORS.buyer)).every((row) => row.read), 'the page did not persist mark-all to the server').toBe(true);
  });

  test('dismiss removes a server row rather than only hiding it locally', async ({ page }) => {
    const before = await inbox(ACTORS.buyer);
    const target = before[0];
    expect(target, 'the fixture must include a notification to dismiss').toBeTruthy();

    await openInbox(page, ACTORS.buyer);
    const card = page.locator('.notif', { hasText: target.title });
    await expect(card).toBeVisible();

    const deletes = [];
    page.on('request', (request) => {
      if (request.url().endsWith(`/api/notifications/${target.id}`) && request.method() === 'DELETE') {
        deletes.push(target.id);
      }
    });
    await card.getByRole('button', { name: 'Dismiss' }).click();

    await expect(card).toHaveCount(0);
    await expect.poll(async () => (await inbox(ACTORS.buyer)).map((row) => row.id), {
      message: 'the page hid a card but the server still owns it',
    }).not.toContain(target.id);
    expect(deletes, 'the page hid a card without issuing DELETE /notifications/{id}').toEqual([target.id]);
  });
});
