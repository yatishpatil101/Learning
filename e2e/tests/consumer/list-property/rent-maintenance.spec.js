import { test, expect } from '@playwright/test';
import { pickDate } from '../../../helpers/datePicker.helper.js';

/* Regression cover for the List Property freeze QA pass:
   1. Rent "Charged Extra" maintenance amount must persist to the saved listing.
      (submit.js compared rentMaintMode against a stale 'excluded' value while the
      UI/store use 'extra', so the amount the owner typed was silently dropped.)
   2. Pill / Toggle selection atoms are keyboard-operable (role + Enter/Space). */

const BASE = 'http://localhost:5173';
const MOBILE = '9876543210';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function seed(page) {
  return page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

test('Rent "Charged Extra" maintenance amount is saved on the listing', async ({ page }) => {
  await seed(page);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });

  // Step 1 — rent flat.
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('900');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });

  // Step 2 — location + rent pricing + Charged Extra maintenance.
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="monthlyRent"]').fill('30000');
  await page.locator('input[data-err="deposit"]').fill('60000');
  await page.locator('.radio-pill', { hasText: 'Charged Extra' }).click();
  await page.locator('input[placeholder="e.g. 2,500"]').fill('2500');
  await pickDate(page, '[data-err="availableFrom"]', '2025-12-31');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 10000 });

  // Step 3 — one photo + the required Ownership Proof doc for a rent listing.
  const buf = Buffer.from(PNG, 'base64');
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: buf });
  await page.locator('input[type="file"][accept="image/*,.pdf"]').first().setInputFiles({ name: 'doc.png', mimeType: 'image/png', buffer: buf });
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 10000 });

  // The saved listing must carry the extra maintenance amount + mode, not blank.
  const saved = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
    const mine = (db.listings || []).find((l) => l.real && l.deal === 'rent' && l.society === 'Skyline Heights');
    return mine ? { rentMaintMode: mine.rentMaintMode, rentMaintenance: mine.rentMaintenance } : null;
  });
  expect(saved).not.toBeNull();
  expect(saved.rentMaintMode).toBe('extra');
  expect(saved.rentMaintenance).toBe('2500');
});

test('Pill and Toggle selection atoms are keyboard-operable', async ({ page }) => {
  await seed(page);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });

  // A pill exposes button semantics + pressed state and toggles via keyboard.
  const rentPill = page.locator('.radio-pill', { hasText: 'Rent' }).first();
  await expect(rentPill).toHaveAttribute('role', 'button');
  await rentPill.focus();
  await rentPill.press('Enter');
  await expect(rentPill).toHaveClass(/selected/);
  await expect(rentPill).toHaveAttribute('aria-pressed', 'true');

  // Space also activates (and must not scroll the page away).
  const salePill = page.locator('.radio-pill', { hasText: 'Sale' }).first();
  await salePill.focus();
  await salePill.press(' ');
  await expect(salePill).toHaveClass(/selected/);
});

