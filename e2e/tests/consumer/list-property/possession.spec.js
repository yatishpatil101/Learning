import { test, expect } from '@playwright/test';
import { pickDate } from '../../../helpers/datePicker.helper.js';

const BASE = 'http://localhost:5173';
const MOBILE = '9876543210';

// Seed an authenticated + Aadhaar-verified owner, then advance to Step 2
// (Location & pricing) where Sale Type + Possession Status live (sale flow).
async function gotoStep2(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now(),
    }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({
      verified: true, aadhaarMobile: mobile, at: Date.now(),
    }));
  }, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });

  // Step 1: minimum required fields, then continue (deal defaults to 'buy').
  await page.locator('input[data-err="carpetArea"]').fill('1050');
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(250);
  const opt = page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' });
  if (await opt.count()) await opt.first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();

  await page.waitForSelector('.gm-style', { timeout: 20000 });
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

test('"Available From" needs a date before the step can advance', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await gotoStep2(page);
  await page.locator('[data-err="possession"]').getByText('Available From', { exact: true }).click();
  // Leave the date empty and try to proceed.
  await page.getByRole('button', { name: /Next Step/i }).click();
  // The date field is flagged invalid and we remain on Step 2 (map still shown).
  await expect(page.locator('[data-err="availableFrom"]')).toHaveClass(/pn-invalid/);
  await expect(page.locator('.gm-style').first()).toBeVisible();
  expect(errors).toHaveLength(0);
});

