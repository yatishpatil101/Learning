// @ts-check
import { test, expect } from '@playwright/test';
import { pickDate } from '../helpers/datePicker.helper.js';

/**
 * Duplicate-property BLOCK modal (end-to-end UI).
 *
 * Seeds an active listing owned by the test user at a known society+unit into the
 * shared mock DB (puneNestDB_v5) â€” the same store every real post is mirrored to â€”
 * then drives the whole List Property wizard as that same owner for the same unit.
 * On submit the app must STOP the second post with the "You've already listed this
 * property" guard + a "Go to my existing listing" CTA, and must NOT create a new
 * live listing.
 *
 * The seed only touches puneNestDB_v5 (not the per-user quota store), so the free
 * one-listing quota stays open and the block we assert is the dedup guard, not the
 * paywall.
 */

const BASE = 'http://localhost:5173';
const MOBILE = '9876500011';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Society + unit shared by the seed and the wizard submission so the address
// fingerprint matches. Kept unusual so it can't collide with seed catalog data.
const SOCIETY = 'ZZ Modal Guard Residency';
const FLAT = 'B-1204';
const PIN = '411045';

function seed(page) {
  return page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Guard Owner', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
    // Seed cookie consent so the DPDPA banner doesn't intercept the bottom Submit button.
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
  }, MOBILE);
}

// Merge the existing listing into the FULL default DB *after* the app has booted.
// Seeding puneNestDB_v5 before boot would write a partial DB (only `listings`) and
// crash the app on load, so the '.lp-meter' selector would never appear.
function seedExistingListing(page) {
  return page.evaluate(({ mobile, society, flat, pin }) => {
    const KEY = 'puneNestDB_v5';
    let db = {};
    try { db = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { db = {}; }
    db.listings = db.listings || [];
    if (db.listings.some((l) => l.id === 'GUARD-EXISTING-1')) return; // idempotent
    db.listings.unshift({
      id: 'GUARD-EXISTING-1',
      title: '2 BHK Flat in Baner',
      ownerMobile: mobile,
      owner: 'Guard Owner',
      deal: 'rent',
      society,
      flatNumber: flat,
      pincode: pin,
      locality: 'Baner',
      status: 'approved',
    });
    localStorage.setItem(KEY, JSON.stringify(db));
  }, { mobile: MOBILE, society: SOCIETY, flat: FLAT, pin: PIN });
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

test('Re-listing the same unit shows the duplicate guard modal and blocks the post', async ({ page }) => {
  await seed(page);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
  // App booted and seeded the full default DB — now merge our existing listing and reload.
  await seedExistingListing(page);
  await page.reload();
  await page.waitForSelector('.lp-meter', { timeout: 10000 });

  // Step 1 â€” rent flat.
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('900');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 20000 });

  // Step 2 â€” the SAME society + unit + pincode as the seeded listing.
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill(FLAT);
  await page.locator('input[data-err="society"]').fill(SOCIETY);
  await page.locator('input[data-err="pincode"]').fill(PIN);
  await page.locator('input[data-err="monthlyRent"]').fill('30000');
  await page.locator('input[data-err="deposit"]').fill('60000');
  await pickDate(page, '[data-err="availableFrom"]', '2025-12-31');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 10000 });

  // Step 3 â€” one photo + the required Ownership Proof doc, then submit.
  const buf = Buffer.from(PNG, 'base64');
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: buf });
  await page.locator('input[type="file"][accept="image/*,.pdf"]').first().setInputFiles({ name: 'doc.png', mimeType: 'image/png', buffer: buf });
  await page.getByRole('button', { name: /Submit Property/i }).click();

  // The duplicate guard must appear â€” and the success screen must NOT.
  await expect(page.getByText(/already listed this property/i)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /Go to my existing listing/i })).toBeVisible();
  await expect(page.locator('text=/Listed Successfully/i')).toHaveCount(0);

  // No new live listing was written for this address (only the seeded one exists).
  const realAtAddress = await page.evaluate((society) => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
    return (db.listings || []).filter((l) => l.society === society && l.real).length;
  }, SOCIETY);
  expect(realAtAddress).toBe(0);

  // The CTA routes the owner to edit their existing listing.
  await page.getByRole('button', { name: /Go to my existing listing/i }).click();
  await expect(page).toHaveURL(/edit=GUARD-EXISTING-1/, { timeout: 10000 });
});

