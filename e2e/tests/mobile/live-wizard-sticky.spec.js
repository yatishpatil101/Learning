import { test, expect } from '../../fixtures/live.js';
import { trackErrors } from '../../helpers/console.js';

/* The owner-side listing wizard on a phone — §G.2 `mobile-wizard-sticky`.

   Step 2 is a ~30KB component with a map, an address grid and ~10 pricing fields.
   Two failures used to compound there: Next sat at the natural end of the form, so
   the user scrolled hundreds of pixels to continue; and when validation failed, the
   first bad field could be 600px *above* the button they just pressed, so pressing
   Next looked like it did nothing. That combination is the biggest supply-side
   conversion leak on mobile, which is why it gets its own guard.

   `mobile-sheets-and-actions` already asserts that step actions dock to the thumb
   arc. This file covers what that one does not: scroll-to-first-error, and the draft
   surviving the tab eviction Android is aggressive about.

   Runs under `mobile` (412x915) and `mobile-small` (360x640). */

const DRAFT_KEY = 'pnDraft:list-property';

/* Only the cookie bar is seeded here: it is bottom-anchored at z-1400, which is precisely where
   the docked step actions this spec measures live. The session is a real owner sign-in. */
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the cookie bar just stays up */ }
  });
}

async function openWizard(page) {
  await page.goto('/list-property');
  await page.locator('.lp-step-actions').first().waitFor({ timeout: 15000 });
}

test.describe('Mobile listing wizard', () => {
  test('the step actions are pinned, not parked at the end of the form', async ({ page, login }) => {
    await withConsent(page);
    await login.asOwner();
    await openWizard(page);

    const actions = page.locator('.lp-step-actions').first();
    const viewportH = page.viewportSize().height;

    /* The bar is `position: sticky` scoped to the step form, not `fixed` to the
       page — so it holds the thumb arc for the whole form and then leaves with its
       container once the form itself has scrolled past (below that point the user
       is in the footer, not the wizard). Deriving the scroll targets from the
       form's own extent tests that contract; a hardcoded deep scroll would instead
       land in the footer on a 360px viewport and fail for the wrong reason. */
    const formBottom = await actions.evaluate((el) => {
      const p = el.parentElement.getBoundingClientRect();
      return window.scrollY + p.bottom;
    });

    for (const y of [0, Math.round(formBottom * 0.4), Math.max(0, Math.round(formBottom - viewportH))]) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(200);

      const box = await actions.boundingBox();
      expect(box, `the action row is laid out at scrollY=${y}`).not.toBeNull();
      expect(box.y, `still within the viewport at scrollY=${y}`).toBeLessThan(viewportH);
      expect(box.y + box.height, `not pushed off the top at scrollY=${y}`).toBeGreaterThan(0);
    }
  });

  test('an invalid Next scrolls the first bad field into view and focuses it', async ({ page, login }) => {
    // The bug: press Next, get nothing visible, because the offending field is off
    // screen above. Step 1 opens with propertyType/bhk/carpetArea empty, so a bare
    // Next is guaranteed to fail validation — no setup needed to reach the error path.
    await withConsent(page);
    await login.asOwner();
    await openWizard(page);

    await page.locator('.lp-step-actions').last().getByRole('button', { name: /next/i }).click();
    await page.waitForTimeout(800);

    const marked = page.locator('.pn-invalid');
    await expect(marked.first(), 'the failing fields are marked').toBeVisible();

    // Whatever came first must have been brought to the user, not left above the fold.
    await expect(marked.first()).toBeInViewport();

    /* …and the caret should be sitting in it, so the next keystroke fixes the problem.
       This is the assertion that caught the real bug: propertyType renders its trigger
       as a <button>, and scrollToError used to look only for input/select/textarea,
       so focus stayed on the Next button the user had just pressed. */
    const focusedInsideError = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return false;
      return !!el.closest('[data-err]');
    });
    expect(focusedInsideError, 'focus moved into the offending field').toBe(true);
  });

  test('every field that fails is marked, not just the first', async ({ page, login }) => {
    await withConsent(page);
    await login.asOwner();
    await openWizard(page);

    await page.locator('.lp-step-actions').last().getByRole('button', { name: /next/i }).click();
    await page.waitForTimeout(800);

    // Red-marking only the first field makes the user play whack-a-mole. Step 1 has
    // several empty required fields, so more than one must light up.
    const marked = page.locator('.pn-invalid');
    expect(await marked.count(), 'all failing fields are marked at once').toBeGreaterThan(1);
  });

  test('the draft survives a reload the way an evicted tab would', async ({ page, login }) => {
    // Android kills backgrounded tabs aggressively; an owner halfway through a
    // 3-step listing must not lose the work. useFormDraft persists to localStorage.
    await withConsent(page);
    await login.asOwner();
    await openWizard(page);

    // Carpet area is the first free-text field visible on step 1. (A bare
    // `input[type=text]` locator picks up a hidden honeypot field instead.)
    const field = page.locator('input[placeholder="e.g. 1050"]').first();
    await field.waitFor({ timeout: 10000 });
    await field.fill('1234');
    await page.waitForTimeout(700);

    const saved = await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY);
    expect(saved, 'the wizard autosaved a draft').toBeTruthy();
    expect(saved).toContain('1234');

    // Reload as an evicted tab would, and the value must come back.
    await page.reload();
    await page.locator('.lp-step-actions').first().waitFor({ timeout: 15000 });
    await expect(page.locator('input[placeholder="e.g. 1050"]').first()).toHaveValue('1234');
  });

  test('the wizard logs no console errors on a phone', async ({ page, login }) => {
    const errors = trackErrors(page);
    await withConsent(page);
    await login.asOwner();
    await openWizard(page);
    expect(errors).toEqual([]);
  });
});
