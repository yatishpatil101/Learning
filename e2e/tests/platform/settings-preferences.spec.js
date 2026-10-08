import { test, expect, ACTORS } from '../../fixtures/live.js';
import { signIn, uniqueMobile, apiLogin, authHeaders, API } from '../../helpers/liveAuth.js';

// Dashboard ▸ Profile & Settings, against the live backend.
const SEEKER = ACTORS.buyer;

test.describe('Dashboard settings', () => {
  test('the Profile & Settings tab renders its cards, offers no language choice, persists Reduce motion and gates erasure', async ({ page, login }) => {
    test.slow();
    await login.asBuyer();
    await page.goto('/dashboard#profile');
    await expect(page.getByRole('heading', { name: 'Notification Preferences' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Privacy & Account' })).toBeVisible();

    await test.step('Delivery channels offer no SMS — Draazy does not send SMS notifications', async () => {
      await expect(page.getByRole('switch', { name: 'WhatsApp' })).toBeVisible();
      await expect(page.getByRole('switch', { name: 'SMS' })).toHaveCount(0);
    });
    await test.step('Settings offers no language choice', async () => {
      await expect(page.getByRole('button', { name: /App language/i })).toHaveCount(0);
      await expect(page.getByText(/मराठी|हिंदी/)).toHaveCount(0);
    });

    await test.step('Reduce motion applies a root class and persists', async () => {
      await page.getByRole('switch', { name: 'Reduce motion' }).click();
      await expect(page.locator('html')).toHaveClass(/dz-reduce-motion/);
      await page.reload();
      await expect(page.locator('html')).toHaveClass(/dz-reduce-motion/);
    });

    await test.step('Account erasure is a reviewed request, not a self-service delete', async () => {
      await page.getByRole('button', { name: /^Request$/ }).click();
      await expect(page.getByRole('heading', { name: 'Request account erasure?' })).toBeVisible();
      const confirm = page.getByRole('button', { name: /Submit request/ });
      await expect(confirm).toBeDisabled();
      await page.getByPlaceholder('ERASE').fill('ERASE');
      await expect(confirm).toBeEnabled();
    });
  });

  test('Light mode repaints the page, keeps teal fills, and persists on this device', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/dashboard#profile');
    const html = page.locator('html');
    const lightMode = page.getByRole('switch', { name: 'Light mode' });
    const bodyBg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const favicon = page.locator('link[rel="icon"]');
    const lightTile = /fill='%23f3f7f6'/;

    await expect(html).not.toHaveClass(/\blight\b/);
    await expect(favicon).toHaveAttribute('href', /fill='%230f0d1a'/);
    await lightMode.click();
    await expect(html).toHaveClass(/\blight\b/);
    expect(await bodyBg()).toBe('rgb(243, 247, 246)');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f3f7f6');
    await expect(favicon).toHaveAttribute('href', lightTile);

    await page.reload();
    await expect(html).toHaveClass(/\blight\b/);
    await expect(lightMode).toHaveAttribute('aria-checked', 'true');
    await expect(favicon).toHaveAttribute('href', lightTile);
    const tealFill = await page.evaluate(() => {
      const probe = Object.assign(document.createElement('div'), { className: 'bg-teal-500 text-white' });
      document.body.append(probe);
      const s = getComputedStyle(probe);
      const out = [s.backgroundColor, s.color];
      probe.remove();
      return out;
    });
    expect(tealFill).toEqual(['rgb(20, 184, 166)', 'rgb(255, 255, 255)']);

    await lightMode.click();
    await expect(html).not.toHaveClass(/\blight\b/);
    expect(await bodyBg()).not.toBe('rgb(243, 247, 246)');
    await expect(favicon).toHaveAttribute('href', /fill='%230f0d1a'/);
  });

  test('the admin header toggles light mode, and tiles stand off the light page', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin');
    const html = page.locator('html');
    const tile = page.locator('.dz-card').first();
    await expect(tile).toBeVisible();

    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(html).toHaveClass(/\blight\b/);
    const [pageBg, tileBg] = await page.evaluate(() => [
      getComputedStyle(document.body).backgroundColor,
      getComputedStyle(document.querySelector('.dz-card')).backgroundColor,
    ]);
    expect(pageBg).toBe('rgb(243, 247, 246)');
    expect(tileBg).not.toBe(pageBg);
    expect(tileBg).not.toMatch(/^rgba?\(255, 255, 255/);

    await page.reload();
    await expect(html).toHaveClass(/\blight\b/);
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(html).not.toHaveClass(/\blight\b/);
  });

  test('a notification channel toggle is a server write, not a localStorage write', async ({ page, login, request }) => {
    await login.asBuyer();
    await page.goto('/dashboard#profile');
    const emailSwitch = page.getByRole('switch', { name: 'Email' });
    await expect(emailSwitch).toHaveAttribute('aria-checked', 'true');

    // Read server state, not old localStorage, so the browser cannot agree only with itself.
    const wrote = page.waitForResponse(
      (r) => r.url().includes('/api/me/notification-preferences') && r.request().method() === 'PUT',
      { timeout: 15_000 },
    );
    await emailSwitch.click();
    const res = await wrote;
    expect(res.status()).toBe(200);

    const sent = res.request().postDataJSON();
    expect(sent.email).toBe(false);
    // Every field present, because the contract requires it.
    for (const key of ['email', 'sms', 'whatsapp', 'matchAlerts', 'language']) {
      expect(sent[key], `PUT body is missing ${key}; the server would 422`).not.toBe(undefined);
    }
    expect(sent.quietHours).toMatchObject({ enabled: expect.anything(), start: expect.any(String), end: expect.any(String) });

    await expect(emailSwitch).toHaveAttribute('aria-checked', 'false');

    // Survives a reload — now because the server was asked, not because the tab remembered.
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Email' })).toHaveAttribute('aria-checked', 'false');

    const readBack = await request.get(`${API}/me/notification-preferences`, { headers: await authHeaders(SEEKER) });
    expect(readBack.status()).toBe(200);
    expect((await readBack.json()).email).toBe(false);

    // Put it back: `SEEKER` is a fixture-registry actor and this is now durable server state, so
    // leaving it off would change what every later spec in the run sees.
    const restored = page.waitForResponse(
      (r) => r.url().includes('/api/me/notification-preferences') && r.request().method() === 'PUT',
    );
    await page.getByRole('switch', { name: 'Email' }).click();
    await restored;
  });

  // Cross-browser persistence is the guarantee localStorage could never make.
  test('notification settings set in one browser are honoured in the next', async ({ page, login, browser }) => {
    await login.asBuyer();
    await page.goto('/dashboard#profile');

    const quiet = page.getByRole('switch', { name: 'Quiet hours' });
    const alerts = page.getByRole('switch', { name: 'New property match alerts' });
    await expect(quiet).toHaveAttribute('aria-checked', 'false');
    await expect(alerts).toHaveAttribute('aria-checked', 'true');

    const wroteQuiet = page.waitForResponse(
      (r) => r.url().includes('/api/me/notification-preferences') && r.request().method() === 'PUT',
      { timeout: 15_000 },
    );
    await quiet.click();
    expect((await wroteQuiet).status()).toBe(200);
    await expect(quiet).toHaveAttribute('aria-checked', 'true');

    const wroteAlerts = page.waitForResponse(
      (r) => r.url().includes('/api/me/notification-preferences') && r.request().method() === 'PUT',
      { timeout: 15_000 },
    );
    await alerts.click();
    const alertsRes = await wroteAlerts;
    expect(alertsRes.status()).toBe(200);
    // The second write carries the *first* change too — evidence the service read the stored
    // document before widening the patch, rather than sending defaults for everything it was not told.
    expect(alertsRes.request().postDataJSON()).toMatchObject({
      matchAlerts: false,
      quietHours: { enabled: true },
    });

    // A different browser entirely — no shared storage, no shared session.
    const fresh = await browser.newContext();
    try {
      const other = await fresh.newPage();
      await signIn(other, SEEKER);
      await other.goto('/dashboard#profile');
      await expect(other.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'true');
      await expect(other.getByRole('switch', { name: 'New property match alerts' })).toHaveAttribute('aria-checked', 'false');
    } finally {
      await fresh.close();
    }

    // Restore durable fixture state because later specs read the same actor.
    for (const control of [quiet, alerts]) {
      const restored = page.waitForResponse(
        (r) => r.url().includes('/api/me/notification-preferences') && r.request().method() === 'PUT',
      );
      await control.click();
      await restored;
    }
    await expect(quiet).toHaveAttribute('aria-checked', 'false');
    await expect(alerts).toHaveAttribute('aria-checked', 'true');
  });

  test('owner number privacy is a real post-approval preference', async ({ page, login }) => {
    // No fabricated listing: `isOwner` is derived from real inventory and Meera has four.
    await login.asOwner();
    await page.goto('/dashboard#profile');
    await expect(page.getByRole('switch', { name: 'Hide my number from approved buyers' })).toBeVisible();
    await expect(page.getByText(/approved buyers (can call you|stay in chat)/i)).toBeVisible();
  });

  // Not driven through the UI, and not on a fixture actor, for one reason each.
  test('verified-contacts-only is stored on the account, not the device', async ({ request }) => {
    const mobile = uniqueMobile();
    await apiLogin(mobile);
    const headers = await authHeaders(mobile);

    const before = await request.get(`${API}/auth/me`, { headers });
    expect(before.ok()).toBeTruthy();
    expect((await before.json()).verifiedContactOnly).toBe(false);

    const patched = await request.patch(`${API}/auth/me`, { headers, data: { verifiedContactOnly: true } });
    expect(patched.status()).toBe(200);
    expect((await patched.json()).verifiedContactOnly).toBe(true);

    // A fresh read, not the write's own echo.
    const after = await request.get(`${API}/auth/me`, { headers });
    expect((await after.json()).verifiedContactOnly).toBe(true);
    // The other switch is untouched: PATCH means "what I named", not "everything on the card".
    expect((await after.json()).hideNumber).toBe(false);
  });

  // Export must describe server data, not one browser's localStorage.
  test('Download my data is answered by the server, with its redaction rule stated', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/dashboard#profile');

    const exported = page.waitForResponse(
      (r) => r.url().includes('/api/me/data-export') && r.request().method() === 'GET',
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: 'Download' }).click();
    const res = await exported;
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.subjectId).toBeTruthy();
    expect(body.redactionRule).toBeTruthy();
    expect(Array.isArray(body.datasets)).toBe(true);
    expect(Array.isArray(body.excluded)).toBe(true);
    expect(body.datasets.length).toBeGreaterThan(0);

    // The rule the whole export rests on, asserted where it actually bites.
    const serialised = JSON.stringify(body.datasets);
    expect(serialised, "the counterparty's number is never in another person's export").not.toContain(
      ACTORS.owner,
    );
    expect(serialised, 'shared records identify the other party by reference').toContain('partyRef');
  });

});
