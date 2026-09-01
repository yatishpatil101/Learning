import { test, expect, ACTORS } from '../../fixtures/live.js';

/**
 * Dashboard ▸ Profile & Settings, against the live backend.
 *
 * Almost everything on this screen is a **device preference** and stays that way after the mock
 * retires: `pnNotifPrefs:<mobile>`, `pnOwnerPrefs:<mobile>`, `pnLang` and the reduce-motion class
 * are read straight from localStorage by `lib/store/notifications.js` and `lib/contact.js`, with no
 * provider in front of them. So the conversion here is not "move the state to the server" — it is
 * that the *person* is now real. The old spec invented `9700000055` and `9800000055` and wrote them
 * into `puneNestUser`; a preference keyed by mobile is only meaningfully persisted if the mobile
 * belongs to an account the server agrees exists.
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

  test('notification channel toggle persists across reload', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/dashboard#profile');
    const emailSwitch = page.getByRole('switch', { name: 'Email' });
    // Default is on — turn it off.
    await expect(emailSwitch).toHaveAttribute('aria-checked', 'true');
    await emailSwitch.click();
    await expect(emailSwitch).toHaveAttribute('aria-checked', 'false');
    const stored = await page.evaluate(
      (mobile) => JSON.parse(localStorage.getItem(`pnNotifPrefs:${mobile}`)),
      SEEKER,
    );
    expect(stored.email).toBe(false);
    // Survives a reload.
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Email' })).toHaveAttribute('aria-checked', 'false');
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
