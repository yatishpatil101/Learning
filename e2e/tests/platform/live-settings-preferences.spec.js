import { test, expect, ACTORS } from '../../fixtures/live.js';
import { signIn } from '../../helpers/liveAuth.js';

/**
 * Dashboard ▸ Profile & Settings, against the live backend.
 *
 * ## What this file used to say, and why half of it is now wrong
 *
 * > "Almost everything on this screen is a **device preference** and stays that way after the mock
 * > retires: `pnNotifPrefs:<mobile>`, `pnOwnerPrefs:<mobile>`, `pnLang` and the reduce-motion class
 * > are read straight from localStorage … with no provider in front of them. So the conversion here
 * > is not 'move the state to the server'."
 *
 * That was true of the client when it was written and false about the platform even then.
 * `MeNotificationPreferencesController` — a `GET` and a `PUT` on `/me/notification-preferences`,
 * with tests and an OpenAPI entry — had existed since D94/D15 and nothing in `frontend/src` had
 * ever called it. Every one of the notification settings lived in one browser, which meant the
 * server enforced none of them: a quiet-hours window suppressed the alerts the *client* derived and
 * nothing else, so a notification the server wrote at 03:00 arrived at 03:00. The paragraph above
 * described the symptom and mistook it for the design.
 *
 * So the notification card **is** now a server document and the conversion **was** "move the state
 * to the server". The rest of the paragraph survives intact: `pnOwnerPrefs`, `pnLang` and the
 * reduce-motion class genuinely are device preferences with no endpoint behind them, and the tests
 * for those are unchanged.
 *
 * The other half of the original note still stands and is the reason this file uses fixture actors:
 * the *person* has to be real. A preference keyed by mobile is only meaningfully persisted if the
 * mobile belongs to an account the server agrees exists — and now that the write is a `PUT` carrying
 * a bearer token, an invented mobile would not merely be untidy, it would 401.
 *
 * That distinction matters most for the owner card. `isOwner` is derived from the caller's actual
 * inventory, so the old spec had to hand itself a fabricated listing to make the card appear. Meera
 * owns four, which means the card renders for the same reason it renders in production.
 */

const SEEKER = ACTORS.buyer;
const OWNER = ACTORS.owner;

test.describe('Dashboard settings', () => {
  test('the Profile & Settings tab renders the new setting cards', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/dashboard#profile');
    await expect(page.getByRole('heading', { name: 'Notification Preferences' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Privacy & Account' })).toBeVisible();
  });

  /**
   * The channel toggle writes to the server, and the request is asserted rather than assumed.
   *
   * This test used to read `localStorage.getItem('pnNotifPrefs:<mobile>')` back and assert
   * `email === false`. That assertion could only ever have proved the browser agreed with itself.
   * What it is really trying to establish is that the switch persisted, and the only evidence of
   * that which a reload cannot fake is a request leaving the tab.
   *
   * The `PUT` carries **all six fields** deliberately: the server marks every one `@NotNull` so
   * that an omitted field cannot be read as "keep whatever is stored", which would make it a `PATCH`
   * wearing a `PUT`'s verb. Asserting the body here is asserting that the client's widen-the-patch
   * step ran — a two-key body would 422, and a 422 that the page swallowed would leave the switch
   * looking exactly like a success.
   */
  test('a notification channel toggle is a server write, not a localStorage write', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/dashboard#profile');
    const emailSwitch = page.getByRole('switch', { name: 'Email' });
    // Default is on — turn it off.
    await expect(emailSwitch).toHaveAttribute('aria-checked', 'true');

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

    // Put it back: `SEEKER` is a fixture-registry actor and this is now durable server state, so
    // leaving it off would change what every later spec in the run sees.
    const restored = page.waitForResponse(
      (r) => r.url().includes('/api/me/notification-preferences') && r.request().method() === 'PUT',
    );
    await page.getByRole('switch', { name: 'Email' }).click();
    await restored;
  });

  /**
   * The one assertion the localStorage arrangement could never make: settings made in one browser
   * are honoured in the next.
   *
   * A second browser context is a genuinely empty browser — its own localStorage, its own session.
   * Under the old scheme neither change below would exist there at all.
   *
   * **Both fields are flipped away from their defaults on purpose.** `quietHours.enabled` defaults
   * to `false` and `matchAlerts` to `true` (`NotificationPreferenceService.java:38`, mirrored in
   * `lib/store/notifications.js`), so a regression in which the fresh browser quietly fell back to
   * the defaults — the exact failure this port exists to prevent, and the one a same-browser reload
   * cannot detect — shows up as both assertions failing rather than as a pass.
   *
   * It deliberately does **not** drive the start/end times. `TimeField` is not an input: it is a
   * `role="button"` that opens a portaled dialog with two dropdowns, an AM/PM group and a Confirm.
   * Driving all that would make this test mostly about the time picker, and the picker already has
   * its own coverage. The two booleans prove the same thing about the same document over the same
   * seam, with a fraction of the anchors to break.
   */
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

    // Restore. This is durable server state on a fixture-registry actor now, not a scratch value in
    // a browser that is about to be thrown away, so leaving it changed would alter what every later
    // spec in the run sees — including the Notifications page, which suppresses its derived match
    // alerts when either of these two is set the way this test sets them.
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

  test('Reduce motion applies a root class and persists', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/dashboard#profile');
    await page.getByRole('switch', { name: 'Reduce motion' }).click();
    await expect(page.locator('html')).toHaveClass(/pn-reduce-motion/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/pn-reduce-motion/);
  });

  test('Delete account requires typing DELETE to confirm', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/dashboard#profile');
    await page.getByRole('button', { name: /^Delete$/ }).click();
    await expect(page.getByRole('heading', { name: 'Delete your account?' })).toBeVisible();
    const confirm = page.getByRole('button', { name: /Delete forever/ });
    await expect(confirm).toBeDisabled();
    await page.getByPlaceholder('DELETE').fill('DELETE');
    await expect(confirm).toBeEnabled();
    // Deliberately stops at "the button became clickable". Rahul is a fixture-registry actor whose
    // saved listings, alert, review and deal are invariants other specs assert on; confirming here
    // would delete him for the rest of the run. The subject is the confirmation gate, and the gate
    // is fully observable without going through it.
  });

  test('owner phone-privacy toggle shows for owners and persists', async ({ page, login }) => {
    // No fabricated listing: `isOwner` is derived from real inventory and Meera has four.
    await login.asOwner();
    await page.goto('/dashboard#profile');
    const priv = page.getByRole('switch', { name: 'Keep my number private' });
    await expect(priv).toBeVisible();
    await priv.click();
    await expect(priv).toHaveAttribute('aria-checked', 'true');
    const stored = await page.evaluate(
      (mobile) => JSON.parse(localStorage.getItem(`pnOwnerPrefs:${mobile}`)),
      OWNER,
    );
    expect(stored.hideNumber).toBe(true);
  });

  test('language setting localizes the app shell', async ({ page, login }) => {
    await page.addInitScript(() => localStorage.setItem('pnLang', 'mr'));
    await login.asBuyer();

    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'सूचना' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0);
    // The seeded version also asserted on the Marathi text of a demo notification
    // (`notifications.seed.n-match-baner`). That row cannot exist here and should not: `seedNotifsIfEmpty`
    // is gated on `!isHttpDomain('notification')` on purpose, because merging eight fabricated rows
    // into a real inbox produces messages the server cannot delete and the user cannot distinguish
    // from genuine ones. The filter rail carries the same evidence — it is page content rather than
    // chrome, so it still proves the translation reached past the header — without needing a fixture
    // the product deliberately refuses to create.
    await expect(page.getByRole('button', { name: 'नवीन जुळण्या' })).toBeVisible();

    // A second route, because one localized page could be a localized route rather than a localized
    // app. The dashboard sidebar is rendered by the shell.
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'आढावा' })).toBeVisible();
  });

  test('changing language in Settings persists to pnLang and switches the app', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/dashboard#profile');
    // Open the language dropdown and pick Marathi.
    await page.getByRole('button', { name: /App language/i }).click();
    await page.getByRole('option', { name: /मराठी/ }).click();
    // Global pref is written and the sidebar switches live.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('pnLang'))).toBe('mr');
    await expect(page.getByRole('button', { name: 'प्रोफाइल व सेटिंग्ज' })).toBeVisible();
  });
});
