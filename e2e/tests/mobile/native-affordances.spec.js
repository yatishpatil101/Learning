import { test, expect } from '../../fixtures/live.js';

// These failures only appear on devices: false share errors or unwanted haptics.
const consent = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
    );
  });

const stubShareCancelled = (page) =>
  page.addInitScript(() => {
    window.__shareCalls = 0;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => {
        window.__shareCalls += 1;
        const e = new Error('Share canceled');
        e.name = 'AbortError';
        return Promise.reject(e);
      },
    });
  });

// Record vibrate calls instead of performing them.
const stubVibrate = (page) =>
  page.addInitScript(() => {
    window.__vibrations = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern) => { window.__vibrations.push(pattern); return true; },
    });
  });

const openFirstProperty = async (page) => {
  await page.goto('/listings');
  const card = page.locator('a[href^="/property/"]').first();
  await expect(card).toBeVisible();
  await card.click();
  await page.waitForURL(/\/property\//);
};

// Saved cards rename the heart, so the locator must handle both states.
const heartOf = (page) =>
  page.getByRole('button', { name: /save property|remove from saved/i }).first();

// Tap the heart, read what the phone did, then tap it back so the row count is unchanged.
const tapHeartAndRestore = async (page) => {
  const heart = heartOf(page);
  await expect(heart).toBeVisible();
  await heart.click();
  await page.waitForTimeout(400);
  const buzzes = await page.evaluate(() => window.__vibrations);
  await heart.click();
  await page.waitForTimeout(400);
  return buzzes;
};

test.describe('Native share', () => {
  test('dismissing the OS share sheet is not reported as a failure', async ({ page }) => {
    await consent(page);
    await stubShareCancelled(page);
    await openFirstProperty(page);

    const share = page.getByRole('button', { name: /share/i }).first();
    await expect(share).toBeVisible();
    await share.click();
    await page.waitForTimeout(600);

    expect(await page.evaluate(() => window.__shareCalls)).toBeGreaterThan(0);

    // ...and cancelling it says nothing.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain("couldn't copy");
    expect(body).not.toContain('could not copy');
    await expect(page.getByTestId('toasts').getByRole('alert'), 'cancelling raises no toast').toHaveCount(0);
  });

  // These share `lib/share.js`; this only proves reachability and a resolvable URL.
  test('a society page can be shared', async ({ page }) => {
    await consent(page);
    await stubShareCancelled(page);
    await page.goto('/societies');
    const soc = page.locator('a[href^="/society/"]').first();
    await expect(soc).toBeVisible();
    await soc.click();
    await page.waitForURL(/\/society\//);

    const share = page.getByRole('button', { name: /^share$/i }).first();
    await expect(share).toBeVisible();
    await share.click();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__shareCalls)).toBeGreaterThan(0);

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('could not copy');
  });

  test('a flatmate room can be shared, and the link points at that room', async ({ page }) => {
    await consent(page);
    await page.addInitScript(() => {
      window.__sharePayload = null;
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data) => {
          window.__sharePayload = data;
          const e = new Error('Share canceled');
          e.name = 'AbortError';
          return Promise.reject(e);
        },
      });
    });
    await page.goto('/flatmates?view=move-in');
    const card = page.locator('.sf-card[data-sf-id^="r:"]').first();
    await card.waitFor({ timeout: 15000 });
    const roomId = (await card.getAttribute('data-sf-id')).slice(2);
    await card.locator('h3 a').click();
    await page.waitForURL(/\/flatmates\/room\//);

    const share = page.getByRole('button', { name: /^share$/i }).first();
    await expect(share).toBeVisible();
    await share.click();
    await page.waitForTimeout(500);

    const payload = await page.evaluate(() => window.__sharePayload);
    expect(payload, 'the OS sheet was handed a payload').not.toBeNull();
    expect(new URL(payload.url).pathname).toBe(`/flatmates/room/${roomId}`);
    expect(payload.text).toMatch(/room in/i);
  });
});

test.describe('Haptics', () => {
  test('saving a listing ticks', async ({ page, login }) => {
    await consent(page);
    await stubVibrate(page);
    await login.asBuyer();

    await page.goto('/listings');
    const buzzes = await tapHeartAndRestore(page);

    expect(buzzes.length, 'save should tick').toBeGreaterThan(0);
  });

  test('a user who asked for less motion is never buzzed', async ({ page, login }) => {
    await consent(page);
    await stubVibrate(page);
    await page.addInitScript(() => {
      localStorage.setItem('dzAppPrefs', JSON.stringify({ reduceMotion: true }));
    });
    await login.asBuyer();

    await page.goto('/listings');
    const buzzes = await tapHeartAndRestore(page);

    // Reduced motion means motion, not just animation. A device buzzing in the hand
    // of someone who turned motion off is the same broken promise as a slide-in.
    expect(buzzes, 'reduce-motion must suppress haptics').toEqual([]);
  });

  test('the OS-level reduced-motion setting is honoured too', async ({ page, login }) => {
    await consent(page);
    await stubVibrate(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await login.asBuyer();

    await page.goto('/listings');
    const buzzes = await tapHeartAndRestore(page);

    expect(buzzes, 'OS reduce-motion must suppress haptics').toEqual([]);
  });
});
// Skeletons reserve layout so arriving content does not shove the page.
test.describe('Loading skeletons', () => {
  test('the shimmer stops for anyone who asked for less motion', async ({ page }) => {
    await consent(page);
    await page.goto('/listings');

    // Mock data can resolve in one frame, so missing skeletons are not conclusive.
    const shimmerOf = () => page.evaluate(() => {
      let probe = document.getElementById('dz-shimmer-probe');
      if (!probe) {
        probe = document.createElement('div');
        probe.id = 'dz-shimmer-probe';
        probe.className = 'skeleton';
        probe.style.cssText = 'width:40px;height:10px;position:fixed;left:-9999px';
        document.body.appendChild(probe);
      }
      return getComputedStyle(probe, '::after').animationName;
    });

    // Prove the shimmer runs first, so the assertion below cannot pass vacuously.
    expect(await shimmerOf(), 'the shimmer must be running to test that it stops').toBe('dzShimmer');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Reduced-motion styles are an allowlist; skeletons must be explicitly included.
    expect(await shimmerOf(), 'reduced motion must stop the shimmer sweep').toBe('none');
  });

  test('the property skeleton reserves the real hero box, so nothing jumps', async ({ page }) => {
    await consent(page);

    // Holding the API response is what keeps the skeleton up long enough to measure it.
    await page.route(/\/properties\/p5000(\?.*)?$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto('/property/p5000');

    const skeleton = page.getByTestId('property-skeleton');
    await skeleton.waitFor({ timeout: 10000 });
    const reserved = await skeleton.locator('.skeleton').nth(1).boundingBox();

    // `.main-image-wrapper` also matches the lightbox's copy, so scope to the first.
    const hero = page.locator('.main-image-wrapper').first();
    await expect(hero).toBeVisible({ timeout: 15000 });
    const real = await hero.boundingBox();

    expect(real, 'the real hero should have a box').not.toBeNull();
    // Measured 412x309 for both on a Pixel 7. Within a pixel is fine; the point
    // is that the placeholder is not a different shape from the thing it stands in for.
    expect(reserved, 'the skeleton should render a hero placeholder').not.toBeNull();
    expect(Math.abs(reserved.width - real.width), 'skeleton hero width must match the real hero').toBeLessThanOrEqual(1);
    expect(Math.abs(reserved.height - real.height), 'skeleton hero height must match the real hero').toBeLessThanOrEqual(1);
  });
});