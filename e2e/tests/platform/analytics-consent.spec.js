import { test, expect } from '../../fixtures/live.js';

const CONSENT_KEY = 'dz_cookie_consent_v1';
const POSTHOG = /^https:\/\/[a-z-]+\.i\.posthog\.com\//;
const CAPTURE = /\/(e|i\/v0\/e|batch|s)\/?(\?|$)/;

// PostHog's hosts are unresolvable in this suite (playwright.config.js); answer them here so loading is observable.
// posthog-js drops events from likely bots: HeadlessChrome in the user agent or its brands, or `navigator.webdriver`.
async function stubPostHog(page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
  });
  const seen = [];
  await page.route(POSTHOG, (route) => {
    const url = route.request().url();
    seen.push(url);
    const script = /\.js(\?|$)/.test(new URL(url).pathname);
    return route.fulfill({
      status: 200,
      contentType: script ? 'application/javascript' : 'application/json',
      body: script ? '' : '{}',
    });
  });
  return seen;
}

const seedConsent = (page, analytics) => page.addInitScript(([key, value]) => {
  localStorage.setItem(key, JSON.stringify({
    necessary: true, functional: true, analytics: value, marketing: false, version: 1, ts: Date.now(),
  }));
}, [CONSENT_KEY, analytics]);

async function flushPageViews(page) {
  const sent = page.waitForRequest((r) => r.url().endsWith('/page-views') && r.method() === 'POST');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  return (await sent).postDataJSON();
}

test.describe('Analytics follow the cookie choice', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });

  test('PostHog loads only after Accept, and stops capturing once withdrawn', async ({ page, consoleErrors }) => {
    const seen = await stubPostHog(page);
    await page.goto('/privacy');
    const banner = page.getByRole('dialog', { name: 'Cookie preferences' });
    await expect(banner).toBeVisible();
    await page.waitForTimeout(1500);
    expect(seen, 'no PostHog request before a choice').toEqual([]);

    await banner.getByRole('button', { name: 'Accept all' }).click();
    await expect.poll(() => seen.some((u) => CAPTURE.test(new URL(u).pathname)), { timeout: 15_000 }).toBe(true);

    await page.evaluate(() => window.dispatchEvent(new Event('pn:open-cookie-preferences')));
    await page.getByRole('button', { name: 'Reject non-essential' }).first().click();
    await page.waitForTimeout(1000);
    seen.length = 0;

    await page.getByRole('navigation', { name: 'Related policies' }).getByRole('link', { name: 'Terms of Service' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
    await page.waitForTimeout(4000);
    expect(seen.filter((u) => CAPTURE.test(new URL(u).pathname)), 'no capture after withdrawal').toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('a session that opens in the back office never loads PostHog', async ({ page, consoleErrors }) => {
    const seen = await stubPostHog(page);
    await seedConsent(page, true);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    expect(seen).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('views from before an Accept are sent unattributed, under a session id the attributed ones do not share', async ({ page }) => {
    await stubPostHog(page);
    await seedConsent(page, false);
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event('pn:open-cookie-preferences')));
    const before = page.waitForRequest((r) => r.url().endsWith('/page-views') && r.method() === 'POST');
    await page.getByRole('button', { name: 'Accept all' }).first().click();
    const earlier = (await before).postDataJSON();
    expect(earlier.attributed).toBe(false);

    await page.getByRole('navigation', { name: 'Related policies' }).getByRole('link', { name: 'Terms of Service' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
    const later = await flushPageViews(page);
    expect(later.attributed).toBe(true);
    expect(later.sessionId).not.toBe(earlier.sessionId);
  });

  for (const analytics of [false, true]) {
    test(`page-view beacon sends attributed=${analytics} when analytics is ${analytics ? 'accepted' : 'declined'}`, async ({ page }) => {
      await stubPostHog(page);
      await seedConsent(page, analytics);
      await page.goto('/privacy');
      await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
      const body = await flushPageViews(page);
      expect(body.attributed).toBe(analytics);
      expect(body.events.length).toBeGreaterThan(0);
    });
  }
});
