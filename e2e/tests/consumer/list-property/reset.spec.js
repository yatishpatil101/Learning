import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';

// Seed an authenticated + Aadhaar-verified owner so the whole-place flow is shown.
async function gotoFlow(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now(),
    }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({
      verified: true, aadhaarMobile: mobile, at: Date.now(),
    }));
  }, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-steps', { timeout: 10000 });
}

test('Start over control is present on the step header', async ({ page }) => {
  await gotoFlow(page);
  await expect(page.getByText('Property details', { exact: true })).toBeVisible();
  await expect(page.locator('.lp-reset')).toBeVisible();
  await expect(page.locator('.lp-reset')).toHaveText(/Start over/);
});

test('Start over asks for confirmation and can be cancelled without losing data', async ({ page }) => {
  await gotoFlow(page);
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1050');

  // Open the confirmation.
  await page.locator('.lp-reset').click();
  await expect(page.getByText('Start over?', { exact: true })).toBeVisible();

  // Cancel — data stays intact.
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByText('Start over?', { exact: true })).toHaveCount(0);
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1050');
});

test('Confirming Start over clears the form and the saved draft', async ({ page }) => {
  const errors = trackErrors(page);
  await gotoFlow(page);

  await page.locator('input[data-err="carpetArea"]').fill('1050');
  /* The autosave is debounced, and the read below goes through `page.evaluate`, which does not
     retry -- so this wait is load-bearing. Polling the draft waits for the write itself rather than
     for a duration somebody timed the debounce at once. */
  await expect
    .poll(async () => page.evaluate(() => localStorage.getItem('pnDraft:list-property')))
    .toContain('1050');
  const draftBefore = await page.evaluate(() => localStorage.getItem('pnDraft:list-property'));
  expect(draftBefore).toContain('1050');

  // Open confirm and commit the reset (triggers a full reload).
  await page.locator('.lp-reset').click();
  /* `exact` matters here: Playwright matches accessible names by substring by default, and the
     modal's close button is labelled "Close Start over?" — which contains "Start over". Two
     matches, and the one that would have been clicked is a coin toss. */
  await page.locator('.pn-modal-panel').getByRole('button', { name: 'Start over', exact: true }).click();

  // Page reloads back into a fresh, still-verified flow.
  await page.waitForSelector('.lp-steps', { timeout: 10000 });
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('');

  // The entered data is gone: a later refresh will now yield a blank form,
  // never the old draft. (A fresh, blank draft may be re-persisted — that's
  // the expected "hold on refresh" behaviour — but it must not carry old data.)
  const draftAfter = await page.evaluate(() => localStorage.getItem('pnDraft:list-property'));
  expect(draftAfter ?? '').not.toContain('1050');
  expect(errors).toHaveLength(0);
});

test('Start over control is present on the Location step header', async ({ page }) => {
  await gotoFlow(page);
  // Advance to step 2.
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  /* The `if (await opt.count())` that used to guard this click is gone with the sleep that made it
     necessary: `count()` does not retry, so against a portalled menu still one frame from open
     (Select.jsx:178) it returned 0, the click was skipped, and the wizard carried its default type
     through a test that appeared to have chosen one. */
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
  const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });

  await expect(page.getByText('Location & pricing', { exact: true })).toBeVisible();
  await expect(page.locator('.lp-reset')).toBeVisible();
});
