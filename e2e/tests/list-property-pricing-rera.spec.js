import { test, expect } from '@playwright/test';
import { pickDate } from '../helpers/datePicker.helper.js';

const BASE = 'http://localhost:5173';
const MOBILE = '9876543210';

function seed(page) {
  return page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

async function gotoForm(page) {
  await seed(page);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
}

async function toStep2(page, type = 'Flat / Apartment') {
  await gotoForm(page);
  await page.locator('input[data-err="carpetArea"]').fill('1000');
  await pickType(page, type);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });
}

async function toStep3(page, type = 'Flat / Apartment') {
  await toStep2(page, type);
  await pickOption(page, 'locality', 'Baner');
  const flat = page.locator('input[data-err="flatNumber"]');
  if (await flat.count()) await flat.fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="price"]').fill('12500000');
  const ownership = page.locator('[data-err="ownership"]');
  if (await ownership.count()) await pickOption(page, 'ownership', 'Freehold');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Property Documents & Verification/i', { timeout: 10000 });
}

test('P1: â‚¹/sq.ft caption appears under Expected Price for a sale once price + area are set', async ({ page }) => {
  await toStep2(page, 'Flat / Apartment');
  await page.locator('input[data-err="price"]').fill('12500000');
  await page.waitForTimeout(150);
  // 1,25,00,000 / 1000 = 12,500 per sq.ft
  await expect(page.getByText(/â‚¹\s*12,500\s*\/\s*sq\.ft/)).toBeVisible();
});

test('P2: MahaRERA field is shown for a flat sale and accepts an ID', async ({ page }) => {
  await toStep3(page, 'Flat / Apartment');
  const rera = page.getByPlaceholder('e.g. P52100012345');
  await expect(rera).toBeVisible();
  await rera.fill('p52100012345');
  // input sanitizes to uppercase alphanumerics
  await expect(rera).toHaveValue('P52100012345');
});

test('P2: MahaRERA field is hidden for Farm Land sale', async ({ page }) => {
  await toStep3(page, 'Farm Land');
  await expect(page.getByPlaceholder('e.g. P52100012345')).toHaveCount(0);
});

test('P2: MahaRERA field is hidden for a rent listing', async ({ page }) => {
  await gotoForm(page);
  // switch deal to Rent before filling, then let the form settle
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('input[data-err="carpetArea"]').fill('1000');
  await pickType(page, 'Flat / Apartment');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="monthlyRent"]').fill('25000');
  await page.locator('input[data-err="deposit"]').fill('75000');
  await pickDate(page, '[data-err="availableFrom"]', '2026-08-01');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Property Documents & Verification/i', { timeout: 10000 });
  await expect(page.getByPlaceholder('e.g. P52100012345')).toHaveCount(0);
});

