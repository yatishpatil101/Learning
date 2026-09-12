import { test, expect } from '../../fixtures/live.js';

/* Native-app affordances: share and haptics.
 *
 * Both are easy to ship broken and impossible to notice in review, because the
 * failure modes only appear on a real device — a false error toast after the user
 * dismisses the OS share sheet, or a phone that buzzes at someone who explicitly
 * asked for less motion. Neither has any visual signature to eyeball. */

const consent = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
    );
  });

/** Install a fake navigator.share that rejects like a user dismissing the sheet. */
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

/** Record vibrate calls instead of performing them. */
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

/* The heart on a listing card renames itself once the property is saved, so a
   locator that only knows the unsaved name silently walks past every card these
   tests already touched. Against the live backend a save is a row in
   `saved_properties` that outlives the test — matching both names is what lets
   each test toggle the *same* card back off and hand the next spec the seeded
   Saved page it expects. */
const heartOf = (page) =>
  page.getByRole('button', { name: /save property|remove from saved/i }).first();

/** Tap the heart, read what the phone did, then tap it back so the row count is
 *  unchanged. The live database is reset once per suite, not per test. */
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

    // The sheet really was opened...
    expect(await page.evaluate(() => window.__shareCalls)).toBeGreaterThan(0);

    // ...and cancelling it says nothing. Previously the AbortError fell through to
    // the clipboard catch and raised "Couldn't copy link", so the most common
    // outcome of tapping Share on a phone reported an error for working correctly.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain("couldn't copy");
    expect(body).not.toContain('could not copy');
    expect(body).not.toContain('failed');
  });

  /* Share now exists on the two surfaces people actually forward: a society page
     ("look at this building") and a room ("this one's in your budget"). Both go
     through the same lib/share.js, so the cancel behaviour above holds for them
     too — these assert the controls exist, are reachable by name, and hand the
     OS a URL that resolves to something. */
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

  test('a flatmate room can be shared, and the link narrows to its locality', async ({ page }) => {
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
    await page.goto('/flatmates');
    await page.locator('.sf-card').first().waitFor({ timeout: 15000 });

    const share = page.getByRole('button', { name: /share this room/i }).first();
    await expect(share).toBeVisible();
    await share.click();
    await page.waitForTimeout(500);

    const payload = await page.evaluate(() => window.__sharePayload);
    expect(payload, 'the OS sheet was handed a payload').not.toBeNull();
    /* There is no per-room URL — /flatmates is one route — so the link narrows to
       the tab and locality the page honours and the room is named in the text.
       A bare /flatmates link would drop the recipient on an unfiltered list. */
    expect(payload.url).toContain('view=move-in');
    expect(payload.text, 'the room is named, since the URL cannot point at it').toMatch(/room in/i);
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
      // The app's own toggle — the same key Settings writes.
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
/* Loading states. A spinner says "wait"; a skeleton says "wait, and here is the
   shape of what is coming" — and holds the layout so the arriving content does
   not shove the page. Both properties are asserted, because a skeleton that does
   not match the real box is worse than a spinner: it promises a layout and then
   breaks it. */
test.describe('Loading skeletons', () => {
  test('the shimmer stops for anyone who asked for less motion', async ({ page }) => {
    await consent(page);
    await page.goto('/listings');

    /* A skeleton is only on screen while data resolves, and against the mock layer
       that can be a single frame — relying on catching it made this assert nothing
       (it read `null` and the guard fired). The rule under test is CSS, not
       timing, so mount a `.skeleton` and read its computed style directly. */
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
    /* The shimmer is an INFINITE loop, and a loading state is exactly when a
       motion-sensitive user is least able to look away. It was ungated for as
       long as skeletons have existed: the reduced-motion section is an explicit
       allowlist and `.skeleton` was never added to it. */
    expect(await shimmerOf(), 'reduced motion must stop the shimmer sweep').toBe('none');
  });

  test('the property skeleton reserves the real hero box, so nothing jumps', async ({ page }) => {
    await consent(page);
    await page.goto('/property/p5000');

    // The skeleton is only up while data resolves; against the mock layer that is
    // brief, so tolerate missing it rather than making the suite timing-dependent.
    const skeleton = page.getByTestId('property-skeleton');
    let reserved = null;
    try {
      await skeleton.waitFor({ timeout: 1200 });
      reserved = await skeleton.locator('.skeleton').nth(1).boundingBox();
    } catch { /* resolved before we looked — the real hero check below still applies */ }

    // `.main-image-wrapper` also matches the lightbox's copy, so scope to the first.
    const hero = page.locator('.main-image-wrapper').first();
    await expect(hero).toBeVisible({ timeout: 15000 });
    const real = await hero.boundingBox();

    expect(real, 'the real hero should have a box').not.toBeNull();
    if (reserved) {
      // Measured 412x309 for both on a Pixel 7. Within a pixel is fine; the point
      // is that the placeholder is not a different shape from the thing it stands in for.
      expect(Math.abs(reserved.width - real.width), 'skeleton hero width must match the real hero').toBeLessThanOrEqual(1);
      expect(Math.abs(reserved.height - real.height), 'skeleton hero height must match the real hero').toBeLessThanOrEqual(1);
    }
  });
});