import { test, expect } from '@playwright/test';
import { trackErrors } from '../../helpers/console.js';

/* The lead-capture step on a phone — §G.2 `mobile-property-contact`.

   This is the conversion moment the whole mobile-first pass exists to protect, and
   it is also the one most exposed to the on-screen keyboard: a 640px viewport with
   the keyboard up leaves ~300px usable, so a centred dialog buries its own submit.
   The fix was to let the shared .pn-modal sheet rules take over below 640px; these
   tests are what stop that regressing.

   Runs under `mobile` (412x915) and `mobile-small` (360x640). Desktop's centred
   dialog is asserted in desktop-noleak-guardrails.spec.js, not here — the mobile
   projects can never disprove a min-width rule. */

const PROP = 'P5000'; // approved seed listing, same one contact-owner-gate.spec.js uses

/** Signed in: the contact gate is a different journey, covered by contact-owner-gate. */
async function signedIn(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test', mobile: '9876500000', role: 'buyer', loginAt: Date.now() }));
      localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the cookie bar just stays up */ }
  });
}

/* The enquiry sheet is the fallback contact channel: with `inAppMessaging` ON,
   Contact Owner queues a chat and navigates to /messages instead (see
   useProperty.handleContact). Turning the flag off is what puts this app in the
   configuration where the enquiry form — the thing this file is about — is the
   contact surface. Mirrors the helper in feature-flags.spec.js. */
async function setAppFlag(page, key, value) {
  await page.evaluate(({ key, value }) => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
    if (!db || !db.settings || !db.settings.flags) return;
    db.settings.flags[key] = value;
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
    window.dispatchEvent(new CustomEvent('punenest-settings-change'));
  }, { key, value });
}

/** Opens the enquiry sheet the way a user does: the sticky CTA, not a direct URL. */
async function openContactSheet(page) {
  await page.goto(`/property/${PROP}`);
  await setAppFlag(page, 'inAppMessaging', false);
  const cta = page.locator('.pn-sticky-cta').getByRole('button', { name: /contact owner/i });
  await cta.waitFor({ timeout: 15000 });
  await cta.click();
  const panel = page.locator('.pn-modal');
  await panel.waitFor({ timeout: 10000 });
  /* The sheet enters with `pnSheetUp` (translateY(100%) -> 0). Measuring synchronously
     catches it mid-slide, a full sheet-height below the fold, and every geometry
     assertion below then fails for a reason that has nothing to do with layout. */
  await page.evaluate(() => {
    const back = document.querySelector('.pn-modal-backdrop');
    if (!back) return undefined;
    return Promise.all(back.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
  });
  return panel;
}

test.describe('Mobile property contact', () => {
  test('the sticky CTA stays in the viewport while the page scrolls', async ({ page }) => {
    // The property page is one of the longest in the app; the whole point of the
    // sticky bar is that Contact never scrolls away from the thumb.
    await signedIn(page);
    await page.goto(`/property/${PROP}`);
    const bar = page.locator('.pn-sticky-cta');
    await bar.waitFor({ timeout: 15000 });

    const viewportH = page.viewportSize().height;
    for (const y of [0, 1200, 4000]) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(120);
      const box = await bar.boundingBox();
      expect(box, `sticky CTA present after scrolling to ${y}`).not.toBeNull();
      expect(box.y, `CTA still on screen at scrollY=${y}`).toBeLessThan(viewportH);
      expect(box.y + box.height, `CTA not pushed below the fold at scrollY=${y}`)
        .toBeGreaterThan(0);
    }
  });

  test('the enquiry overlay opens as a bottom sheet, not a centred dialog', async ({ page }) => {
    await signedIn(page);
    await openContactSheet(page);

    const geom = await page.evaluate(() => {
      const panel = document.querySelector('.pn-modal');
      const back = document.querySelector('.pn-modal-backdrop');
      const p = panel.getBoundingClientRect();
      const b = back.getBoundingClientRect();
      return {
        panelBottom: p.bottom,
        backBottom: b.bottom,
        panelWidth: p.width,
        backWidth: b.width,
        align: getComputedStyle(back).alignItems,
        radius: getComputedStyle(panel).borderBottomLeftRadius,
        maxH: p.height,
        viewportH: window.innerHeight,
      };
    });

    expect(geom.align, 'backdrop docks its child to the bottom').toBe('flex-end');
    expect(geom.radius, 'the edge meeting the screen is squared off').toBe('0px');
    expect(Math.abs(geom.panelBottom - geom.backBottom), 'flush with the viewport bottom')
      .toBeLessThanOrEqual(1);
    expect(geom.panelWidth, 'full-bleed').toBeCloseTo(geom.backWidth, 0);
    // 88dvh: the sheet must leave the page visible behind it, so it reads as a sheet
    // over content rather than a takeover.
    expect(geom.maxH, 'sheet is bounded, not full-screen').toBeLessThan(geom.viewportH);
  });

  test('the sheet scrolls internally instead of growing past the viewport', async ({ page }) => {
    // The failure this guards: an unbounded panel pushes its own submit off-screen,
    // which is exactly what the centred dialog used to do.
    await signedIn(page);
    await openContactSheet(page);

    const r = await page.evaluate(() => {
      const panel = document.querySelector('.pn-modal');
      return {
        overflowY: getComputedStyle(panel).overflowY,
        scrollH: panel.scrollHeight,
        clientH: panel.clientHeight,
        bottom: panel.getBoundingClientRect().bottom,
        viewportH: window.innerHeight,
      };
    });

    expect(['auto', 'scroll'], 'the panel owns its own scroll').toContain(r.overflowY);
    expect(r.bottom, 'the panel never extends past the viewport').toBeLessThanOrEqual(r.viewportH + 1);
  });

  test('the submit stays reachable once the message field has focus', async ({ page }) => {
    // Playwright cannot raise a real soft keyboard, so the proxy is: focus the
    // textarea, then assert the send button is inside the panel's scrollport and
    // can actually be scrolled to. A submit that is unreachable here is unreachable
    // with 300px of usable height too.
    await signedIn(page);
    await openContactSheet(page);

    const textarea = page.locator('.pn-modal textarea');
    await expect(textarea).toBeVisible();
    await textarea.click();
    await textarea.fill('Is this still available for viewing this weekend?');

    const send = page.locator('.pn-modal').getByRole('button', { name: /send enquiry/i });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport();

    const box = await send.boundingBox();
    expect(box.height, 'the primary action clears the touch floor').toBeGreaterThanOrEqual(44);
  });

  test('the message field asks the keyboard for a send key', async ({ page }) => {
    // enterKeyHint is the difference between a generic "return" and a labelled
    // action on the soft keyboard — free conversion on the step we care most about.
    await signedIn(page);
    await openContactSheet(page);
    await expect(page.locator('.pn-modal textarea')).toHaveAttribute('enterkeyhint', 'send');
  });

  test('the close control clears the touch minimum', async ({ page }) => {
    await signedIn(page);
    await openContactSheet(page);
    const box = await page.locator('.pn-modal-x').first().boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test('opening the sheet does not log console errors', async ({ page }) => {
    const errors = trackErrors(page);
    await signedIn(page);
    await openContactSheet(page);
    expect(errors).toEqual([]);
  });
});
