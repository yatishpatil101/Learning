import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { rejectListingWithFetch } from '../../../helpers/moderation.js';

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

async function legacyNotificationKeys(page) {
  return page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key === 'dzDismissedNotifs' || key.startsWith('dzNotifications:')));
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

  test('renders server-owned inbox rows, filters their mapped categories and loads clean', async ({ page, consoleErrors }) => {
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

    const ids = new Set(before.map((row) => row.id));
    const renderedIds = await page.locator('.notif').evaluateAll((rows) => rows.map((row) => row.dataset.id));
    expect(renderedIds.every((id) => ids.has(id)), 'the page rendered a notification id the server did not return').toBe(true);

    const unreadCount = before.filter((row) => !row.read).length;
    await expect(page.getByLabel(`Notifications, ${unreadCount} unread`).locator('visible=true')).toBeVisible();
    await expect(page.getByText(`${unreadCount} unread updates`)).toBeVisible();

    await page.getByRole('button', { name: 'Updates' }).click();
    await expect(page.locator('.notif')).not.toHaveCount(0);
    await expect(page.getByText(match.title)).toBeVisible();
    await expect(page.getByText(enquiry.title)).toHaveCount(0);

    await expect(page.getByRole('link', { name: /Manage notification preferences/ })).toBeVisible();
    expect(await legacyNotificationKeys(page), 'legacy notification storage keys should be cleared on load').toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('a new account sees the empty inbox, no demo seed on screen or in storage', async ({ page }) => {
    const mobile = uniqueMobile();
    await openInbox(page, mobile);

    expect(await inbox(mobile), 'a new account starts with an empty server inbox').toHaveLength(0);
    await expect(page.getByText("You're all caught up — no notifications yet.")).toBeVisible();
    await expect(page.locator('.notif')).toHaveCount(0);
    for (const title of SEED_TITLES) {
      await expect(page.getByText(title), `"${title}" is demo content and must not render`).toHaveCount(0);
    }

    expect(await legacyNotificationKeys(page), 'legacy notification storage keys leaked into a live inbox').toEqual([]);
  });

  test('the top-bar badge appears only for real unread notifications and clears once they are read', async ({ page }) => {
    const mobile = uniqueMobile();
    await seedConsent(page);
    await signedInAs(page, mobile);
    await page.goto('/');

    const bell = page.getByRole('button', { name: /^Notifications, \d+ unread$/ }).locator('visible=true');
    await expect(bell).toHaveAccessibleName('Notifications, 0 unread');
    await expect(bell, 'an empty inbox must not show a badge').toHaveText('');

    const ownerHeaders = await authHeaders(mobile);
    const posted = await fetch(`${API}/me/listings`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        deal: 'rent', propertyType: 'Flat', price: 24000, city: 'Pune', bhk: 2, area: 720, locality: 'Baner',
        title: `Zztest badge ${Date.now().toString(36)}`,
        images: await uploadedListingPhotos(ownerHeaders),
      }),
    });
    const listing = await posted.json();
    expect(posted.status, JSON.stringify(listing)).toBe(201);
    const rejected = await rejectListingWithFetch(listing.id, await authHeaders(ACTORS.admin));
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);

    const unread = (await inbox(mobile)).filter((row) => !row.read);
    expect(unread.map((row) => row.type)).toContain('listing.rejected');

    await page.reload();
    await expect(bell).toHaveAccessibleName(`Notifications, ${unread.length} unread`);
    await expect(bell).toHaveText(String(unread.length));

    await bell.click();
    const marked = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/api/notifications/read') && response.status() === 204);
    await page.getByRole('dialog').getByRole('button', { name: 'Mark all read' }).click();
    await marked;

    await expect(bell).toHaveAccessibleName('Notifications, 0 unread');
    await expect(bell, 'the badge must go once nothing is unread').toHaveText('');
    expect((await inbox(mobile)).every((row) => row.read)).toBe(true);
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
