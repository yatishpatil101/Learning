import { test, expect } from '../../fixtures/live.js';
import { trackErrors } from '../../helpers/console.js';
import { LIST_PROPERTY_DRAFT_KEY as DRAFT_KEY } from '../../helpers/listingForm.helper.js';

/* Covers what `mobile-sheets-and-actions` does not: scroll-to-first-error on a step whose first
   bad field can sit 600px above the button just pressed, and draft survival across tab eviction. */

/* Only the cookie bar is seeded here: it is bottom-anchored at z-1400, and the wizard's last
   fields sit in the same strip on a phone. The session is a real owner sign-in. */
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the cookie bar just stays up */ }
  });
}

/* `asNewOwner`, not `asOwner`: seeded owners are over the free-tier allowance, so `/list-property`
   answers them with the upgrade prompt and never renders `.lp-step-actions`. */
async function openWizard(page) {
  await page.goto('/list-property');
  await page.locator('.lp-step-actions').first().waitFor({ timeout: 15000 });
}

test.describe('Mobile listing wizard', () => {
  test('the step actions end the form instead of floating over it', async ({ page, login }) => {
    await withConsent(page);
    await login.asNewOwner();
    await openWizard(page);

    const actions = page.locator('.lp-step-actions').first();

    /* In flow means the row scrolls with the form: its viewport position must move by the amount
       scrolled. A sticky row would hold its place and the delta would be ~0. */
    const before = (await actions.boundingBox()).y;
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(200);
    const after = (await actions.boundingBox()).y;
    expect(Math.round(before - after), 'the row scrolled with the form').toBeGreaterThan(250);

    /* …and the primary action hugs the right edge, inside a right thumb's arc, rather than
       spanning the width as a bar. */
    await page.evaluate(() => window.scrollTo(0, 0));
    const vw = page.viewportSize().width;
    const primary = actions.getByRole('button', { name: /next/i });
    const actionsBox = await actions.boundingBox();
    const box = await primary.boundingBox();
    expect(box.width, 'compact, not a full-width bar').toBeLessThan(vw * 0.6);
    expect(
      Math.abs((actionsBox.x + actionsBox.width) - (box.x + box.width)),
      'button right edge aligns with the form action row',
    ).toBeLessThanOrEqual(2);
  });

  /* Label-based rather than `data-err`-based: the flatmate fork marks none of these fields
     required, and the whole-place fork suffixes its required labels with " *". */
  const rowTracks = (page, labelText) => page.evaluate((text) => {
    const label = [...document.querySelectorAll('label')]
      .find((el) => el.textContent.trim().replace(/\s*\*$/, '') === text);
    const grid = label?.parentElement?.parentElement;
    return grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : 0;
  }, labelText);

  // Assert the entire menu so an extra diagonal cannot hide behind a no-search assertion.
  async function chooseDetail(page, label, options, value) {
    const trigger = page.getByText(label, { exact: true }).locator('..').locator('.dz-dropdown__trigger');
    await trigger.click();
    const menu = page.locator('.dz-dropdown__menu.is-portal-open');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option')).toHaveText(options);
    await expect(menu.locator('.dz-dropdown__search')).toHaveCount(0);
    await menu.getByRole('option', { name: value, exact: true }).click();
    await expect(trigger).toHaveText(value);
  }

  async function chooseFacingAndView(page) {
    await chooseDetail(page, 'Facing', ['East', 'West', 'North', 'South'], 'North');
    await chooseDetail(page, 'Overlooking', ['Garden', 'Amenity', 'Parking', 'Main Road'], 'Garden');
    await expect(page.getByText('Facing', { exact: true }).locator('..').locator('.dz-dropdown__trigger')).toHaveText('North');
  }

  test('shows completed details and pairs compact property controls', async ({ page, login }) => {
    await withConsent(page);
    await login.asNewOwner();
    await openWizard(page);

    expect(await rowTracks(page, 'Carpet Area'), 'carpet and built-up areas share the row').toBe(2);
    expect(await rowTracks(page, 'Facing'), 'facing and overlooking share the row').toBe(2);
    await chooseFacingAndView(page);

    await page.getByRole('button', { name: 'Rent', exact: true }).click();
    await page.getByRole('button', { name: /Find a flatmate/ }).click();
    await expect(page.getByText('Room Offered *', { exact: true })).toBeVisible();

    for (const gone of ['Carpet Area', 'Built-up Area', 'Facing', 'Overlooking', 'Age of Property']) {
      await expect(page.getByText(gone, { exact: true }), `${gone} is not a flatmate question`).toHaveCount(0);
    }
  });

  test('all furnishing choices fit one row without smaller text or shorter tiles', async ({ page, login }) => {
    await withConsent(page);
    await login.asNewOwner();
    await openWizard(page);
    for (const flatmate of [false, true]) {
      if (flatmate) {
        await page.getByRole('button', { name: 'Rent', exact: true }).click();
        await page.getByRole('button', { name: /Find a flatmate/ }).click();
      }
      for (const width of [360, 390, 412, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        const pills = page.getByRole('button', { name: /^(Unfurnished|Semi-Furnished|Furnished)$/ });
        await expect(pills).toHaveCount(3);
        // Pills animate padding, so measure the settled layout after crossing the breakpoint.
        await expect(async () => {
          const boxes = await pills.evaluateAll((elements) => elements.map((el) => {
            const r = el.getBoundingClientRect();
            const parent = el.parentElement.getBoundingClientRect();
            const css = getComputedStyle(el);
            return { top: r.top, left: r.left, right: r.right, parentLeft: parent.left, parentRight: parent.right,
              font: css.fontSize, padTop: css.paddingTop, padBottom: css.paddingBottom, height: r.height };
          }));
          expect(Math.max(...boxes.map((b) => b.top)) - Math.min(...boxes.map((b) => b.top)), `one row at ${width}px (flatmate=${flatmate}): ${JSON.stringify(boxes)}`).toBeLessThan(1);
          if (width < 640) {
            expect(Math.abs(boxes[0].left - boxes[0].parentLeft), 'first tile starts at the row edge').toBeLessThan(1);
            expect(Math.abs(boxes[2].right - boxes[2].parentRight), 'last tile fills the row to the right edge').toBeLessThan(1);
          }
          for (const box of boxes) {
            expect(box.left).toBeGreaterThanOrEqual(box.parentLeft - 1);
            expect(box.right).toBeLessThanOrEqual(box.parentRight + 1);
            expect(box.font).toBe('14px');
            expect(box.padTop).toBe('12px');
            expect(box.padBottom).toBe('12px');
            expect(box.height).toBeGreaterThanOrEqual(44);
          }
        }).toPass({ timeout: 3000 });
      }
      await page.getByRole('button', { name: 'Furnished', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Furnished', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Unfurnished', exact: true }).click();
    }
  });

  test('legacy drafts restore a view separately from the compass direction', async ({ page, login }) => {
    await withConsent(page);
    await login.asNewOwner();
    for (const [facing, view] of [['Park Facing', 'Garden'], ['Road Facing', 'Main Road']]) {
      await page.evaluate(({ key, facing }) => {
        localStorage.setItem(key, JSON.stringify({ propertyType: 'flat', facing }));
      }, { key: DRAFT_KEY, facing });
      await openWizard(page);
      await expect(page.getByRole('button', { name: 'Facing', exact: true })).toHaveText('Select facing');
      await expect(page.getByRole('button', { name: 'Overlooking', exact: true })).toHaveText(view);
      await page.goto('/');
    }
  });

  /* A 390px screen spent 40px a side on gutters, and the unit chip trailing an area input
     clipped the placeholder beside it ("e.g. 105" for "e.g. 1050"). */
  test('the form spends its narrow width on fields, not on gutters', async ({ page, login }) => {
    await withConsent(page);
    await login.asNewOwner();
    await openWizard(page);

    const card = page.locator('.lp-page .glass-card').filter({ has: page.locator('.lp-step') });
    const pad = await card.evaluate((el) => {
      const s = getComputedStyle(el);
      return { left: s.paddingLeft, right: s.paddingRight, top: s.paddingTop };
    });
    expect(pad, 'only the horizontal gutter was halved').toEqual({ left: '12px', right: '12px', top: '24px' });

    /* Asserted against the input's own size rather than a literal, so this stays true if
       the base field type scale moves. */
    const suffix = page.getByText('sq.ft.', { exact: true }).first();
    const chrome = await suffix.evaluate((el) => {
      const s = getComputedStyle(el);
      const field = getComputedStyle(el.parentElement.querySelector('input'));
      return {
        background: s.backgroundColor,
        radius: s.borderRadius,
        smaller: parseFloat(s.fontSize) < parseFloat(field.fontSize),
        reserved: parseFloat(field.paddingRight),
      };
    });
    expect(chrome.background, 'the unit is text, not a chip').toBe('rgba(0, 0, 0, 0)');
    expect(chrome.radius).toBe('0px');
    expect(chrome.smaller, 'the unit reads quieter than the value').toBe(true);

    /* The gutter must still clear the unit it exists for, and no more. */
    const box = await suffix.boundingBox();
    const field = await suffix.evaluate((el) => el.parentElement.querySelector('input').getBoundingClientRect().right);
    expect(chrome.reserved).toBeGreaterThan(field - box.x);
    expect(chrome.reserved).toBeLessThan(64);
  });

  test('an invalid Next scrolls the first bad field into view and focuses it', async ({ page, login }) => {
    // Step 1 opens with propertyType/bhk/carpetArea empty, so a bare Next is guaranteed to fail
    // validation on a field scrolled off screen — no setup needed to reach the error path.
    await withConsent(page);
    await login.asNewOwner();
    await openWizard(page);

    await page.locator('.lp-step-actions').last().getByRole('button', { name: /next/i }).click();
    await page.waitForTimeout(800);

    const marked = page.locator('.dz-invalid');
    await expect(marked.first(), 'the failing fields are marked').toBeVisible();

    // Whatever came first must have been brought to the user, not left above the fold.
    await expect(marked.first()).toBeInViewport();

    /* The caret must land in the field, so the next keystroke fixes it: propertyType renders its
       trigger as a <button>, which a focus search over input/select/textarea alone misses. */
    const focusedInsideError = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return false;
      return !!el.closest('[data-err]');
    });
    expect(focusedInsideError, 'focus moved into the offending field').toBe(true);
  });

  test('every field that fails is marked, not just the first', async ({ page, login }) => {
    await withConsent(page);
    await login.asNewOwner();
    await openWizard(page);

    await page.locator('.lp-step-actions').last().getByRole('button', { name: /next/i }).click();
    await page.waitForTimeout(800);

    // Red-marking only the first field makes the user play whack-a-mole. Step 1 has
    // several empty required fields, so more than one must light up.
    const marked = page.locator('.dz-invalid');
    expect(await marked.count(), 'all failing fields are marked at once').toBeGreaterThan(1);
  });

  test('the draft survives a reload the way an evicted tab would', async ({ page, login }) => {
    // Android kills backgrounded tabs aggressively; an owner halfway through a
    // 3-step listing must not lose the work. useFormDraft persists to localStorage.
    await withConsent(page);
    await login.asNewOwner();
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
    await login.asNewOwner();
    await openWizard(page);
    expect(errors).toEqual([]);
  });
});
