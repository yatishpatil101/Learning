import { test, expect } from '@playwright/test';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { trackErrors } from '../../../helpers/console.js';

/* Video-recorded reproduction of the EXACT manual steps a real user takes:
   sign in as a NORMAL user (role 'user', no pre-existing listings), post a
   flatmate via /list-property, then open the dashboard "My Listings" tab.
   Records video so we can visually confirm the listing appears. */

test.use({
  video: 'on',
  viewport: { width: 1280, height: 900 },
});

const BASE = 'http://localhost:5173';
const MOBILE = '9700012345';
const SOCIETY = 'Video Test Society ' + Date.now();

async function seedNormalUser(page) {
  await page.addInitScript((mobile) => {
    // A NORMAL user (role 'user'), NOT an owner, with NO pre-existing listings/rooms.
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Video Tester', mobile, role: 'user', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
}

test('VIDEO: normal user posts a flatmate and sees it in My Listings', async ({ page }) => {
  const errors = trackErrors(page);

  await seedNormalUser(page);

  // --- Post a Property -> flatmate ---
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 15000 });

  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await page.getByText('Find a flatmate').click();

  await page.locator('[data-err="bhk"] .radio-pill', { hasText: '2 BHK' }).click();
  await page.locator('[data-err="roomType"] .radio-pill', { hasText: 'Private room' }).click();

  // Step 1 -> Step 2 (Location & Price)
  await page.getByRole('button', { name: /Next Step/i }).click();

  await page.locator('[data-err="locality"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: 'Baner' }).first().click();

  await page.locator('input[data-err="society"]').fill(SOCIETY);
  await page.locator('input[data-err="rentShare"]').fill('13500');
  await pickDate(page, '[data-err="availableFrom"]', '2026-09-01');

  // Step 2 -> Step 3 (Photos)
  await page.getByRole('button', { name: /Next Step/i }).click();

  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'room.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'),
  });
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: /Post & Find Flatmates/i }).click();

  // Success screen
  await expect(page.getByText(/Flatmate Listing Posted/i)).toBeVisible({ timeout: 10000 });

  // App SPA-navigates to /dashboard (Overview). Open My Listings via deep-link.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 8000 });
  await page.waitForTimeout(800);

  // Diagnostics for the console/log trail
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('puneNestRoomListings') || '[]'));
  console.log('STORED ROOMS COUNT:', stored.length, '| owner mobiles:', stored.map((r) => r.ownerMobile).join(','));

  // Is the "My Properties" tab visible for a normal user? (isOwner via rooms)
  const tabVisible = await page.getByRole('button', { name: /My Properties/i }).first().isVisible().catch(() => false);
  console.log('MY PROPERTIES TAB VISIBLE:', tabVisible);

  await page.goto(`${BASE}/dashboard#listings`);
  await page.waitForTimeout(1500);

  const bodyText = await page.locator('body').innerText();
  console.log('DASHBOARD SHOWS SOCIETY:', bodyText.includes(SOCIETY));

  await expect(page.getByText(SOCIETY).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Flatmate', { exact: true }).first()).toBeVisible();

  expect(errors).toHaveLength(0);
});

