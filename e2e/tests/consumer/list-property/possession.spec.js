/* No identity badge is granted: the wizard has no identity gate, and granting one here would
   quietly assert the opposite of what `live-no-gate` proves. */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';

// Sign in as a real owner, then advance to Step 2 (Location & pricing) where
// Possession Status lives (sale flow).
async function gotoStep2(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });

  // Step 1: minimum required fields, then continue (deal defaults to 'buy').
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  /* `count()` does not retry, so guarding this click on it silently skips the choice against a
     portalled menu one frame from open (Select.jsx:178). Wait for the menu instead. */
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  const opt = page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' });
  await expect(opt).toHaveCount(1);
  await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();

  await page.waitForSelector('.gm-style', { timeout: 30000 });
  return mobile;
}

test('sale flow omits Sale Type while keeping ownership and possession', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoStep2(page);
  await expect(page.locator('[data-err="ownership"]')).toBeVisible();
  await expect(page.locator('[data-err="possession"]')).toBeVisible();
  await expect(page.getByText('Sale Type', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Fresh builder sale, or a resale by the current owner?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New Property', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resale', exact: true })).toHaveCount(0);
  await expect(page.getByText('Transaction Type')).toHaveCount(0);
  await expect(page.getByText('New Booking')).toHaveCount(0);
  const progress = await page.evaluate(async () => {
    const { computeProgress } = await import('/src/pages/consumer/list-property/progress.js');
    const { initialForm } = await import('/src/pages/consumer/list-property/initialForm.js');
    return ['', 'new', 'resale'].map((transactionType) => computeProgress({
      form: { ...initialForm, deal: 'buy', transactionType },
    }));
  });
  expect(progress[1]).toEqual(progress[0]);
  expect(progress[2]).toEqual(progress[0]);
});

test('Possession Status offers two options', async ({ page }) => {
  await gotoStep2(page);
  const group = page.locator('[data-err="possession"]');
  await expect(group.getByText('Ready to Move', { exact: true })).toBeVisible();
  await expect(group.getByText('Available From', { exact: true })).toBeVisible();
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
  await expect(page.locator('.dz-cal')).toBeVisible();
  await expect(page.locator('.dz-cal__title')).toHaveText('Select Date');
});

test('selected date is displayed as DD/MM/YYYY', async ({ page }) => {
  await gotoStep2(page);
  await page.locator('[data-err="possession"]').getByText('Available From', { exact: true }).click();
  const field = page.locator('[data-err="availableFrom"]');
  await pickDate(page, '[data-err="availableFrom"]', '2025-03-14');
  await expect(field.locator('.dz-datefield__text')).toHaveText('14/03/2025');
});

test('"Available From" needs a date before the step can advance', async ({ page, consoleErrors }) => {
  await gotoStep2(page);
  await page.locator('[data-err="possession"]').getByText('Available From', { exact: true }).click();
  // Leave the date empty and try to proceed.
  await page.getByRole('button', { name: /Next Step/i }).click();
  // The date field is flagged invalid and we remain on Step 2 (map still shown).
  await expect(page.locator('[data-err="availableFrom"]')).toHaveClass(/dz-invalid/);
  await expect(page.locator('.gm-style').first()).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});
