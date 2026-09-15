// No identity badge is granted: the wizard has no identity gate, so granting one would quietly
// assert the opposite of what the sibling `no-gate` spec proves.
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

  // Sharing a grid is what makes them sit side by side rather than stretch full-width.
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

async function gotoAddressStep(page) {
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  // `count()` does not retry, so assert the option exists before clicking rather than guarding on it.
  const opt = page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
}

test('Locality dropdown is folded into the compact address grid on step 2', async ({ page }) => {
  await gotoFlow(page);
  await gotoAddressStep(page);

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

/* Unit and wing are halves of one address line. Asserting geometry rather than structure because
   the two widths reach the same result by different means — a nested 2-column grid below `sm`,
   `display: contents` above it — and only the rendered row is the promise to the owner. */
for (const [name, width] of [['mobile', 390], ['desktop', 1280]]) {
  test(`Flat/Unit No and Wing/Block share one line on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoFlow(page);
    await gotoAddressStep(page);

    const box = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const flat = r('input[data-err="flatNumber"]');
      const wing = r('input[autocomplete="address-line2"]:not([data-err])');
      return { flatTop: flat.top, wingTop: wing.top, flatRight: flat.right, wingLeft: wing.left };
    });
    expect(Math.abs(box.flatTop - box.wingTop)).toBeLessThan(2);
    expect(box.flatRight).toBeLessThanOrEqual(box.wingLeft);
  });
}

// The portalled menu is `opacity: 0; pointer-events: none` for one frame after opening, so waiting
// on `.is-portal-open` is what makes it genuinely interactive.
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
