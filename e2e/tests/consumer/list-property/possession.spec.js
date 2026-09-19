/* No identity badge is granted: the wizard has no identity gate, and granting one here would
   quietly assert the opposite of what `live-no-gate` proves. */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';

// Sign in as a real owner, then advance through the address step to the pricing step where
// Possession Status lives (sale flow).
async function gotoPricing(page) {
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
  for (const [dataErr, value] of [['floor', '9'], ['totalFloors', '14']]) {
    await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.getByRole('option', { name: value, exact: true }).click();
  }
  await page.getByRole('button', { name: /Next Step/i }).click();

  await page.waitForSelector('.gm-style', { timeout: 30000 });

  // The address step: a locality choice drops the pin, and the three boxes it cannot fill.
  await page.locator('[data-err="locality"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option').first().click();
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  return mobile;
}

test('sale flow omits Sale Type while keeping ownership and possession', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoPricing(page);
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

test('Possession Status offers the three construction states the search facet knows', async ({ page }) => {
  await gotoPricing(page);
  const group = page.locator('[data-err="possession"]');
  for (const option of ['Ready to Move', 'New Launch', 'Under Construction']) {
    await expect(group.getByText(option, { exact: true })).toBeVisible();
  }
  // The old "Available From" conflated a handover DATE with a construction STATE, and the wire
  // vocabulary has no such value — a listing posted under it matched neither facet.
  await expect(group.getByText('Available From', { exact: true })).toHaveCount(0);
});

test('a pre-completion choice reveals a date picker', async ({ page }) => {
  await gotoPricing(page);
  // A completed home with a future handover is still ready to move, so it is asked no date.
  await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
  await expect(page.locator('[data-err="availableFrom"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'New Launch', exact: true }).click();
  const dateField = page.locator('[data-err="availableFrom"]');
  await expect(dateField).toBeVisible();
  // The field opens the app's custom calendar dropdown (no native date input).
  await dateField.click();
  await expect(page.locator('.dz-cal')).toBeVisible();
  await expect(page.locator('.dz-cal__title')).toHaveText('Select Date');
});

test('selected date is displayed as DD/MM/YYYY', async ({ page }) => {
  await gotoPricing(page);
  await page.getByRole('button', { name: 'Under Construction', exact: true }).click();
  const field = page.locator('[data-err="availableFrom"]');
  await pickDate(page, '[data-err="availableFrom"]', '2027-03-14');
  await expect(field.locator('.dz-datefield__text')).toHaveText('14/03/2027');
});

test('a pre-completion sale needs a handover date before the step can advance', async ({ page, consoleErrors }) => {
  await gotoPricing(page);
  await page.getByRole('button', { name: 'Under Construction', exact: true }).click();
  // Leave the date empty and try to proceed.
  await page.getByRole('button', { name: /Next Step/i }).click();
  // The date field is flagged invalid and we remain on the pricing step.
  await expect(page.locator('[data-err="availableFrom"]')).toHaveClass(/dz-invalid/);
  await expect(page.getByText('Photos & documents')).toHaveCount(0);
  expect(consoleErrors).toHaveLength(0);
});
