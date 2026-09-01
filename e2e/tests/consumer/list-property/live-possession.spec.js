/**
 * Sale Type and Possession Status on the posting wizard's second step, against the live backend.
 *
 * Converted from `possession.spec.js`, which wrote `puneNestUser` and an Aadhaar record straight
 * into localStorage. That shortcut is why the mock version could not have caught a step 2 that
 * never arrives for a real session: it only ever proved that the fields render in a browser that
 * had been told it was signed in, and the walk from step 1 to step 2 — the Next Step submit, the
 * map mounting, whatever the page fetches on the way — ran with no server behind it at all. Here
 * the account is registered over HTTP and carries a genuine JWT, so "Possession Status offers two
 * options" now also means the wizard got as far as showing them for an account the server
 * recognises, and a token the API refuses fails the test instead of going unnoticed.
 *
 * No Aadhaar badge is granted. The wizard has no identity gate (D-no-gate), and granting one here
 * would quietly assert the opposite of what `live-no-gate` proves.
 *
 * The date assertion is deliberately left driving the shared `pickDate` helper rather than filling
 * the input: the field is the app's own calendar dropdown, not a native date input, and the
 * DD/MM/YYYY rendering is only worth asserting if a real pick produced it.
 */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';

// Sign in as a real owner, then advance to Step 2 (Location & pricing) where
// Sale Type + Possession Status live (sale flow).
async function gotoStep2(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });

  // Step 1: minimum required fields, then continue (deal defaults to 'buy').
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

  await page.waitForSelector('.gm-style', { timeout: 30000 });
  return mobile;
}

test('Transaction Type is reframed as a clearer "Sale Type"', async ({ page }) => {
  await gotoStep2(page);
  await expect(page.getByText('Sale Type', { exact: true })).toBeVisible();
  await expect(page.getByText('Fresh builder sale, or a resale by the current owner?')).toBeVisible();
  await expect(page.getByText('New Property', { exact: true })).toBeVisible();
  await expect(page.getByText('Resale', { exact: true })).toBeVisible();
  // The confusing old labels are gone.
  await expect(page.getByText('Transaction Type')).toHaveCount(0);
  await expect(page.getByText('New Booking')).toHaveCount(0);
});

test('Possession Status offers two options', async ({ page }) => {
  await gotoStep2(page);
  const group = page.locator('[data-err="possession"]');
  await expect(group.getByText('Ready to Move', { exact: true })).toBeVisible();
  await expect(group.getByText('Available From', { exact: true })).toBeVisible();
  // "Under Construction" was removed — it's no longer offered.
  await expect(group.getByText('Under Construction')).toHaveCount(0);
});

test('choosing "Available From" reveals a date picker', async ({ page }) => {
  await gotoStep2(page);
  // Not shown by default (default possession is "Ready to Move").
  await expect(page.locator('[data-err="availableFrom"]')).toHaveCount(0);
  await page.locator('[data-err="possession"]').getByText('Available From', { exact: true }).click();
  const dateField = page.locator('[data-err="availableFrom"]');
  await expect(dateField).toBeVisible();
  // The field opens the app's custom calendar dropdown (no native date input).
  await dateField.click();
  await expect(page.locator('.pn-cal')).toBeVisible();
  await expect(page.locator('.pn-cal__title')).toHaveText('Select Date');
});

test('selected date is displayed as DD/MM/YYYY', async ({ page }) => {
  await gotoStep2(page);
  await page.locator('[data-err="possession"]').getByText('Available From', { exact: true }).click();
  const field = page.locator('[data-err="availableFrom"]');
  await pickDate(page, '[data-err="availableFrom"]', '2025-03-14');
  await expect(field.locator('.pn-datefield__text')).toHaveText('14/03/2025');
});

test('"Available From" needs a date before the step can advance', async ({ page, consoleErrors }) => {
  await gotoStep2(page);
  await page.locator('[data-err="possession"]').getByText('Available From', { exact: true }).click();
  // Leave the date empty and try to proceed.
  await page.getByRole('button', { name: /Next Step/i }).click();
  // The date field is flagged invalid and we remain on Step 2 (map still shown).
  await expect(page.locator('[data-err="availableFrom"]')).toHaveClass(/pn-invalid/);
  await expect(page.locator('.gm-style').first()).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});
