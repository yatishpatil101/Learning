import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const MOBILE = '9876543210';

async function gotoFlow(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-steps', { timeout: 10000 });
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
    const trigger = document.querySelector('[data-err="propertyType"] .pn-dropdown__trigger');
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
  await page.waitForTimeout(250);
  const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
  if (await opt.count()) await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });

  const paired = await page.evaluate(() => {
    const loc = document.querySelector('[data-err="locality"]');
    const flat = document.querySelector('[data-err="flatNumber"]');
    const grid = loc && loc.closest('.grid');
    return !!(grid && flat && grid.contains(flat));
  });
  expect(paired).toBe(true);

  // Locality still selects correctly after being moved into the grid.
  await page.locator('[data-err="locality"] .pn-dropdown__trigger').click();
  await page.waitForTimeout(200);
  const first = page.locator('.pn-dropdown__option').first();
  const chosen = (await first.innerText()).trim();
  await first.click();
  await expect(page.locator('[data-err="locality"] .pn-dropdown__value')).toHaveText(chosen);
});

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

// Design rule (DESIGN_SYSTEM.md → Control Width): a standalone dropdown with a
// short option set must not stretch the full form width on desktop.
const soloRatio = (page, labelText) => page.evaluate((text) => {
  const label = [...document.querySelectorAll('.lp-step label')].find((l) => l.textContent.trim().startsWith(text));
  const cell = label && label.parentElement;
  const control = cell && cell.querySelector('.pn-dropdown__trigger, input, textarea, select');
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
