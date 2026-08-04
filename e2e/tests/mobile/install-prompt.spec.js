import { test, expect } from '../../fixtures/base.js';

/* Home-screen install nudge (InstallPrompt.jsx).
 *
 * The product requirement this suite actually protects is "don't nag": the
 * feature's whole risk is that it becomes the thing users close on every visit.
 * So the assertions are weighted towards silence — it must not appear to someone
 * who just landed, must not reappear after a decline, and must never appear once
 * the app is installed. The happy path is one test; the not-annoying contract is
 * six.
 *
 * Engagement is driven by real navigation rather than a mocked clock, because
 * the gate the component ships is page views, not elapsed time. The view counter
 * persists, so `browse()` below doubles as proof that engagement accumulates
 * across visits instead of resetting on every load. */

const CONSENT = { necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() };
const DAY = 24 * 60 * 60 * 1000;

/* The consent bar owns the bottom of the screen and deliberately suppresses the
   nudge, so every test here answers it first — otherwise we'd only ever be
   asserting that the cookie gate works. */
async function seedConsent(page) {
  await page.addInitScript((c) => {
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify(c));
  }, CONSENT);
}

/* Pre-load the nudge's own record. Used to place a visitor at a specific point
   in the dismissal ladder without having to act it out. */
async function seedState(page, over) {
  await page.addInitScript((s) => {
    localStorage.setItem('pn_install_prompt_v1', JSON.stringify(s));
  }, { dismissals: 0, lastDismissAt: 0, installed: false, views: 99, version: 1, ...over });
}

/* Walk enough of the app to clear MIN_VIEWS. Separate page loads, not
   client-side hops, so this also proves the count survives a reload.
   Waits for the app shell on each stop: a view is only counted once the app has
   actually rendered, which is the intended behaviour — someone who bounces
   before first paint has not "started using" anything. */
async function browse(page, routes = ['/', '/listings', '/saved']) {
  for (const r of routes) {
    await page.goto(r);
    await page.locator('.pn-bottom-nav').waitFor({ state: 'visible' });
  }
}

/* Stand in for Chromium's beforeinstallprompt. Records prompt() calls on window
   so a test can prove the browser dialog was actually requested. */
async function fireInstallEvent(page, outcome = 'accepted') {
  await page.evaluate((o) => {
    const e = new Event('beforeinstallprompt');
    e.prompt = () => { window.__pnPromptCalls = (window.__pnPromptCalls || 0) + 1; };
    e.userChoice = Promise.resolve({ outcome: o, platform: 'web' });
    window.dispatchEvent(e);
  }, outcome);
}

const card = (page) => page.getByRole('dialog', { name: /one tap away/i });
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('pn_install_prompt_v1')));

test.describe('PWA install nudge', () => {
  test('stays hidden on arrival, and appears only once the visitor is using the app', async ({ page }) => {
    await seedConsent(page);
    await browse(page, ['/']);
    await fireInstallEvent(page);

    // The install event has fired, so the only thing withholding the card is the
    // engagement gate. Greeting a first-time visitor with an install ask is the
    // failure mode this whole feature exists to avoid.
    await expect(card(page)).toBeHidden();

    await browse(page, ['/listings', '/saved']);
    await fireInstallEvent(page);
    await expect(card(page)).toBeVisible();
  });

  test('never appears without an install path — no dead button', async ({ page }) => {
    await seedConsent(page);
    // No beforeinstallprompt (Firefox Android, or Chrome before its own
    // engagement heuristic). On a non-iOS UA there is nothing to offer, so
    // asking would produce a button that cannot do anything.
    await browse(page);
    await expect(card(page)).toBeHidden();
  });

  test('Install asks the browser for its real dialog', async ({ page }) => {
    await seedConsent(page);
    await browse(page);
    await fireInstallEvent(page, 'accepted');

    await card(page).getByRole('button', { name: /install app/i }).click();
    // prompt() is the only way a site can trigger installation; if this stops
    // being called the card is decorative.
    expect(await page.evaluate(() => window.__pnPromptCalls)).toBe(1);
    await expect(card(page)).toBeHidden();
  });

  test('a decline is remembered — it does not come back next visit', async ({ page }) => {
    await seedConsent(page);
    await browse(page);
    await fireInstallEvent(page);
    await card(page).getByRole('button', { name: /not now/i }).click();
    await expect(card(page)).toBeHidden();
    expect((await stored(page)).dismissals).toBe(1);

    // A fresh visit, already well past the engagement gate. Inside the one-week
    // cooldown the nudge stays silent even though the event fires again.
    await page.goto('/');
    await fireInstallEvent(page);
    await expect(card(page)).toBeHidden();
  });

  test('declining the browser dialog counts as a dismissal, same as Not now', async ({ page }) => {
    await seedConsent(page);
    await browse(page);
    await fireInstallEvent(page, 'dismissed');
    await card(page).getByRole('button', { name: /install app/i }).click();

    // Saying no in Chrome's own dialog is the same answer as "Not now". Treating
    // it as neutral would re-ask a user who has already declined.
    await expect.poll(() => stored(page).then((s) => s.dismissals)).toBe(1);
    await expect(card(page)).toBeHidden();
  });

  test('the second cooldown is longer than the first', async ({ page }) => {
    await seedConsent(page);
    // Two dismissals, eight days ago: past the 7-day first cooldown, inside the
    // 14-day second. This pins the escalation — a flat 7-day cooldown would pass
    // the single-dismissal test above but must fail here.
    await seedState(page, { dismissals: 2, lastDismissAt: Date.now() - 8 * DAY });
    await page.goto('/');
    await fireInstallEvent(page);
    await expect(card(page)).toBeHidden();
  });

  test('goes quiet permanently after the third decline', async ({ page }) => {
    await seedConsent(page);
    // Three declines on record, the last long enough ago that any finite
    // cooldown would have expired — only the terminal state can keep it hidden.
    await seedState(page, { dismissals: 3, lastDismissAt: Date.now() - 400 * DAY });
    await page.goto('/');
    await fireInstallEvent(page);
    await expect(card(page)).toBeHidden();
  });

  test('never shown to someone who already installed the app', async ({ page }) => {
    await seedConsent(page);
    await seedState(page, { installed: true });
    await page.goto('/');
    await fireInstallEvent(page);
    await expect(card(page)).toBeHidden();
  });

  test('is mobile-only chrome', async ({ page }) => {
    await seedConsent(page);
    await browse(page);
    await fireInstallEvent(page);
    await expect(card(page)).toBeVisible();

    // A home-screen icon is a phone affordance; on desktop the card would be a
    // banner selling something the user cannot meaningfully act on.
    await expect(page.locator('.pn-safe-x.z-\\[1350\\]')).toHaveClass(/lg:hidden/);
  });
});
