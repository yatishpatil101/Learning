import { test, expect } from '../../fixtures/live.js';

/* The suite protects "don't nag": most assertions check silence. Engagement is driven by real navigation
   because the component gates on page views, not elapsed time. */

const CONSENT = { necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() };
const DAY = 24 * 60 * 60 * 1000;

/* The consent bar suppresses the nudge, so each test answers it first; else only the cookie gate is tested. */
async function seedConsent(page) {
  await page.addInitScript((c) => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify(c));
  }, CONSENT);
}

async function seedState(page, over) {
  await page.addInitScript((s) => {
    localStorage.setItem('dz_install_prompt_v1', JSON.stringify(s));
  }, { dismissals: 0, lastDismissAt: 0, installed: false, views: 99, version: 1, ...over });
}

/* Separate page loads prove the view count survives reload; a view counts only once the app has rendered. */
async function browse(page, routes = ['/', '/listings', '/saved']) {
  for (const r of routes) {
    await page.goto(r);
    await page.locator('.dz-bottom-nav').waitFor({ state: 'visible' });
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
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('dz_install_prompt_v1')));

test.describe('PWA install nudge', () => {
  test('stays hidden on arrival, and appears only once the visitor is using the app', async ({ page }) => {
    await seedConsent(page);
    await browse(page, ['/']);
    await fireInstallEvent(page);

    // Install event fired, so only the engagement gate withholds the card from a first-time visitor.
    await expect(card(page)).toBeHidden();

    await browse(page, ['/listings', '/saved']);
    await fireInstallEvent(page);
    await expect(card(page)).toBeVisible();
  });

  test('never appears without an install path — no dead button', async ({ page }) => {
    await seedConsent(page);
    // Without beforeinstallprompt a non-iOS UA has nothing to offer, so asking would show a dead button.
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

  test('the cooldown ladder, the terminal decline and the installed flag keep it quiet — each with a control that shows it', async ({ context }) => {
    test.slow();

    // Each blocked state is paired with its nearest un-blocked neighbour, so a pass proves the
    // state and not an install event that never rendered.
    const expectCard = async (over, visible) => {
      const page = await context.newPage();
      try {
        await seedConsent(page);
        await seedState(page, over);
        await browse(page, ['/']);
        await fireInstallEvent(page);
        if (visible) await expect(card(page)).toBeVisible();
        else await expect(card(page)).toBeHidden();
      } finally {
        await page.close();
      }
    };

    await test.step('the second cooldown is longer than the first', async () => {
      // Two dismissals, eight days ago: past the 7-day first cooldown, inside the 14-day second.
      // A flat 7-day cooldown would pass the single-dismissal test above but must fail here.
      await expectCard({ dismissals: 2, lastDismissAt: Date.now() - 8 * DAY }, false);
      await expectCard({ dismissals: 2, lastDismissAt: Date.now() - 15 * DAY }, true);
    });

    await test.step('goes quiet permanently after the third decline', async () => {
      // The last decline is long enough ago that any finite cooldown would have expired —
      // only the terminal state can keep it hidden.
      await expectCard({ dismissals: 3, lastDismissAt: Date.now() - 400 * DAY }, false);
      await expectCard({ dismissals: 2, lastDismissAt: Date.now() - 400 * DAY }, true);
    });

    await test.step('never shown to someone who already installed the app', async () => {
      await expectCard({ installed: true }, false);
      await expectCard({}, true);
    });
  });

  test('is mobile-only chrome: visible on a phone, gone at desktop width', async ({ page }) => {
    await seedConsent(page);
    await browse(page);
    await fireInstallEvent(page);
    await expect(card(page)).toBeVisible();

    // A home-screen icon is a phone affordance; on desktop the card would be a
    // banner selling something the user cannot meaningfully act on.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(card(page)).toBeHidden();
  });
});
