import { test, expect } from '@playwright/test';
import { signedInAsNew } from '../../helpers/liveAuth.js';

/* Phone-only: the scroll lock behind a full-screen sheet and a home-indicator inset, neither of
 * which a 1280px run can observe. Both modals need a signed-in account, hence the live half. */

/** `?post=` is the app-wide posting intent, consumed on arrival — see `useFlatmateSupply.jsx`. */
async function openModal(page, intent) {
  await page.goto(`/flatmates?post=${intent}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.sf-modal')).toBeVisible({ timeout: 30_000 });
}

/** The root element's effective overflow — `hidden` exactly while some overlay holds the lock. */
const rootOverflow = (page) => page.evaluate(() => getComputedStyle(document.documentElement).overflowY);

test.describe('Flatmates modals', () => {
  for (const [name, intent] of [['post request', '1'], ['flat-share group', 'group']]) {
    test(`the ${name} sheet holds the board still behind it`, async ({ page }) => {
      await signedInAsNew(page);
      await openModal(page, intent);

      /* Read off the ROOT: `index.css` gives html `overflow-x: clip`, so body's overflow never
         propagates to the viewport and `document.body.style.overflow = 'hidden'` is a no-op here. */
      expect(await rootOverflow(page), 'the board must not move under the open sheet').toBe('hidden');

      await page.keyboard.press('Escape');
      await expect(page.locator('.sf-modal')).toHaveCount(0);

      // The other half, which a missing or mis-counted release breaks.
      expect(await rootOverflow(page), 'closing must hand scrolling back').not.toBe('hidden');
    });
  }

  test('the sheet contains its own overscroll and pads clear of the home indicator', async ({ page }) => {
    await signedInAsNew(page);
    await openModal(page, '1');
    const modal = page.locator('.sf-modal');

    /* This element is the scroller, so without containment a thumb that reaches the end of the form
       hands the rest of the gesture to the results behind it. */
    await expect(modal).toHaveCSS('overscroll-behavior-y', 'contain');

    /* Emulation reports every `env(safe-area-inset-*)` as 0, so the inset arrives through the token
       the rule consumes. Measured as a delta because the base gutter is viewport-relative. */
    const padding = () => modal.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    const base = await padding();
    await page.addStyleTag({ content: ':root { --dz-safe-b: 34px; }' });
    expect(await padding() - base).toBeCloseTo(34, 1);

    /* `vh` is measured against the large viewport, so the gutter would be cut by the URL bar. Read
       off the declaration: under emulation the two units resolve alike. */
    const declared = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; } // cross-origin sheet
        for (const r of rules) if (r.selectorText === '.sf-modal') return r.style.cssText;
      }
      return '';
    });
    expect(declared).toContain('dvh');
  });

  test('Escape closes the picker on top of the sheet, not the sheet under it', async ({ page }) => {
    await signedInAsNew(page);
    await openModal(page, '1');

    /* The lifestyle picker presents as its own sheet on a phone. Its Escape lives on the menu while
       the form's lives on `document`, so without `stopPropagation` one press dismisses both. */
    const sheet = page.locator('.sf-modal');
    // Scoped: the filter drawer stays mounted behind the sheet and offers a `Lifestyle` button too.
    await sheet.getByRole('button', { name: 'Lifestyle preferences' }).click();
    const menu = page.locator('.dz-menu, [role="listbox"]').first();
    await expect(menu).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(sheet).toBeVisible();

    // And the lock survives, because the form that holds it never unmounted.
    expect(await rootOverflow(page)).toBe('hidden');
  });

  test('Escape still closes the sheet with the cookie bar on screen', async ({ page }) => {
    await signedInAsNew(page);
    /* `ConsumerLayout` renders the cookie bar after the outlet as a `role="dialog"`, so a top-most
       guard counting it kills the sheet's Escape. An init script, as the consent seeding is one. */
    await page.addInitScript(() => localStorage.removeItem('dz_cookie_consent_v1'));
    await openModal(page, '1');
    await expect(page.getByRole('dialog', { name: 'Cookie preferences' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.sf-modal')).toHaveCount(0);
  });
});
