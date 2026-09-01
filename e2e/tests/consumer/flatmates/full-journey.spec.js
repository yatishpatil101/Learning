import { test, expect } from '@playwright/test';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { trackErrors } from '../../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9811122233';
const SOCIETY = 'E2E Residency ' + Date.now();

async function seed(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'E2E Owner', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
  }, MOBILE);
}

test('post a flatmate via UI, then see it in dashboard My Listings', async ({ page }) => {
  const errors = trackErrors(page);

  await seed(page);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 15000 });

  // Property For -> Rent
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  // What would you like to do? -> Find a flatmate
  await page.getByText('Find a flatmate').click();

  /* ---------- STEP 1 · Details ---------- */
  // Flat type: 2 BHK
  await page.locator('[data-err="bhk"] .radio-pill', { hasText: '2 BHK' }).click();
  // Room offered: Private room
  await page.locator('[data-err="roomType"] .radio-pill', { hasText: 'Private room' }).click();
  // Physical-flat detail parity with the whole-place rent flow renders on step 1.
  await expect(page.locator('label', { hasText: /^Floor No\.$/ })).toBeVisible();
  // Furnishing -> Furnished reveals the furniture selector.
  await page.getByText('Furnished', { exact: true }).click();
  await expect(page.getByText(/What's included\?/i)).toBeVisible();
  // Advance to Location & Price.
  await page.getByRole('button', { name: /Next Step/i }).click();

  /* ---------- STEP 2 · Location & Price ---------- */
  // The address + map picker are shared with the whole-place flow.
  await expect(page.getByText(/Pin the flat location/i)).toBeVisible();
  // Flat / Unit No. free-text.
  await page.getByPlaceholder('e.g. B-1203').fill('B-1203');
  // Locality — also drops the map pin (sets the location).
  await page.locator('[data-err="locality"]').click();
  /* `Select` portals its menu and only flips `portalOpen` one requestAnimationFrame after the open
     (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198). That
     one frame is what the sleep here was waiting out. */
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.pn-dropdown__option', { hasText: 'Baner' }).first().click();
  // Society
  await page.locator('input[data-err="society"]').fill(SOCIETY);
  // Pincode (optional)
  await page.getByPlaceholder('411045').fill('411045');
  // Rent share
  await page.locator('input[data-err="rentShare"]').fill('14000');
  // Available from
  await pickDate(page, '[data-err="availableFrom"]', '2026-08-01');
  // Advance to Photos.
  await page.getByRole('button', { name: /Next Step/i }).click();

  /* ---------- STEP 3 · Photos ---------- */
  await expect(page.getByText(/Drag & drop or click to upload/i)).toBeVisible();
  // Photo upload (required)
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'room.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'),
  });
  // The thumbnail is the proof the file reached component state; submitting before it renders
  // posts a listing with no photo and the failure surfaces three steps later.
  await expect(page.locator('.grid img')).toHaveCount(1);

  // Submit
  await page.getByRole('button', { name: /Post & Find Flatmates/i }).click();

  // Success screen
  await expect(page.getByText(/Flatmate Listing Posted/i)).toBeVisible({ timeout: 10000 });

  // App SPA-navigates to /dashboard (Overview). The listing lives under
  // My Properties → My Listings, reachable via the #listings deep-link.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 6000 });

  /* Both sleeps that used to bracket this navigation were padding: the assertion below already
     retries for ten seconds, and a `goto` does not need to be waited for before it is issued. */
  await page.goto(`${BASE}/dashboard#listings`);

  await expect(page.getByText(SOCIETY).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Flatmate', { exact: true }).first()).toBeVisible();

  // The physical-flat details + map pin persist on the stored room record.
  const room = await page.evaluate((society) => {
    const rooms = JSON.parse(localStorage.getItem('puneNestRoomListings') || '[]');
    return rooms.find((r) => r.society === society) || null;
  }, SOCIETY);
  expect(room).not.toBeNull();
  expect(room.flatNumber).toBe('B-1203');
  expect(room.pincode).toBe('411045');
  expect(room.furnishing).toBe('furnished');
  expect(room.bathrooms).toBe(2);
  // Reused map picker geo-pins the room instead of leaving it on a bare locality.
  expect(typeof room.lat).toBe('number');
  expect(typeof room.lng).toBe('number');

  expect(errors).toHaveLength(0);
});

