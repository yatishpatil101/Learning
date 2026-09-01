/**
 * The posting wizard's field layout - pairing, width caps, and the type-specific controls - against
 * the live backend.
 *
 * Converted from `layout.spec.js`, which faked its session by writing `draazyUser` and an Aadhaar
 * record into localStorage before the first navigation. Layout assertions are the ones that suffer
 * most from that shortcut, because a measurement is only meaningful if the thing being measured is
 * the screen a real session gets. A seeded browser renders whatever the client will render for a
 * token nobody checked; if the wizard were to fail to mount for an account the server recognises,
 * or if a type-specific block were gated on data that only arrives over HTTP, the mock version
 * would still have found its grids and its `.dz-dropdown__trigger` and reported the ratios as
 * healthy. Here the account is registered over HTTP and carries a real JWT, so "Property Type and
 * BHK share a row" now also carries "and they do so on the page a genuine session loads".
 *
 * No Aadhaar badge is granted. The wizard has no identity gate, so granting one would quietly
 * assert the opposite of what the sibling `no-gate` spec proves.
 */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

async function gotoFlow(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

test('Property Type and BHK share one compact row (dropdown is not full-width)', async ({ page }) => {
  await gotoFlow(page);

  // Both controls live in the same grid — i.e. they sit side by side, so the
  // Property Type dropdown occupies about half the width instead of stretching.
  const paired = await page.evaluate(() => {
    const pt = document.querySelector('[data-err="propertyType"]');
    const bhk = document.querySelector('[data-err="bhk"]');
    const grid = pt && pt.closest('.grid');
    return !!(grid && bhk && grid.contains(bhk));
  });
  expect(paired).toBe(true);

  // The Property Type trigger is meaningfully narrower than the form card.
  const ratio = await page.evaluate(() => {
    const trigger = document.querySelector('[data-err="propertyType"] .dz-dropdown__trigger');
    const card = trigger && trigger.closest('.lp-step');
    if (!trigger || !card) return 1;
    return trigger.getBoundingClientRect().width / card.getBoundingClientRect().width;
  });
  expect(ratio).toBeLessThan(0.7);
});

test('BHK pills read as numbers, consistent with Bathrooms/Balconies', async ({ page }) => {
  await gotoFlow(page);
  const labels = await page.locator('[data-err="bhk"] .radio-pill').allInnerTexts();
  expect(labels.map((t) => t.trim())).toEqual(['1', '2', '3', '4+']);
});

test('Locality dropdown is folded into the compact address grid on step 2', async ({ page }) => {
  await gotoFlow(page);
  // Advance to step 2.
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  /* The `if (await opt.count())` that used to guard this click is gone along with the sleep that
     made it necessary: `count()` does not retry, so against a menu still one frame from open it
     returned 0, the click was skipped, and the wizard carried its default type through a test that
     appeared to have chosen one. */
  const opt = page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });

  const paired = await page.evaluate(() => {
    const loc = document.querySelector('[data-err="locality"]');
    const flat = document.querySelector('[data-err="flatNumber"]');
    const grid = loc && loc.closest('.grid');
    return !!(grid && flat && grid.contains(flat));
  });
  expect(paired).toBe(true);

  // Locality still selects correctly after being moved into the grid.
  await page.locator('[data-err="locality"] .dz-dropdown__trigger').click();
  await menuOpen(page);
  const first = page.locator('.dz-dropdown__option').first();
  const chosen = (await first.innerText()).trim();
  await first.click();
  await expect(page.locator('[data-err="locality"] .dz-dropdown__value')).toHaveText(chosen);
});

/**
 * Waits for a custom `Select` menu to be genuinely interactive.
 *
 * `Select.jsx` portals its menu and sets `portalOpen` one `requestAnimationFrame` after the open
 * (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198), gaining
 * `.is-portal-open` afterwards. That one frame is what the dropdown sleeps here were waiting out.
 */
async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

// Design rule (DESIGN_SYSTEM.md → Control Width): a standalone dropdown with a
// short option set must not stretch the full form width on desktop.
const soloRatio = (page, labelText) => page.evaluate((text) => {
  const label = [...document.querySelectorAll('.lp-step label')].find((l) => l.textContent.trim().startsWith(text));
  const cell = label && label.parentElement;
  const control = cell && cell.querySelector('.dz-dropdown__trigger, input, textarea, select');
  const card = control && control.closest('.lp-step');
  if (!control || !card) return 1;
  return control.getBoundingClientRect().width / card.getBoundingClientRect().width;
}, labelText);

test('standalone land dropdowns (Water Source, Zoning) are width-capped, not full-page', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });

  await gotoFlow(page);
  await pickType(page, 'Farm Land');
  expect(await soloRatio(page, 'Water Source')).toBeLessThan(0.7);

  await pickType(page, 'Open Plot');
  expect(await soloRatio(page, 'Zoning')).toBeLessThan(0.7);
});

test('Commercial "Suitable For" pairs with Maintenance/CAM and is width-capped', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });

  await gotoFlow(page);
  await pickType(page, 'Commercial');

  // Suitable For and Maintenance / CAM share one grid row — no lone stretched
  // control, no empty half beside either field.
  const paired = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.lp-step label')];
    const suitable = labels.find((l) => l.textContent.trim().startsWith('Suitable For'));
    const cam = labels.find((l) => l.textContent.trim().startsWith('Maintenance / CAM'));
    const grid = suitable && suitable.closest('.grid');
    return !!(grid && cam && grid.contains(cam));
  });
  expect(paired).toBe(true);

  expect(await soloRatio(page, 'Suitable For')).toBeLessThan(0.7);
  expect(await soloRatio(page, 'Maintenance / CAM')).toBeLessThan(0.7);
});
