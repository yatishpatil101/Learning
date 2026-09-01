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

const BASE = process.env.BASE_URL || 'http://localhost:5173';
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
  /* `Select` portals its menu and only flips `portalOpen` one requestAnimationFrame after the open
     (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198). That
     one frame is what the sleep here was waiting out. */
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
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
  // The thumbnail is the proof the file reached component state; submitting before it renders
  // posts a listing with no photo and the failure surfaces three steps later.
  await expect(page.locator('.grid img')).toHaveCount(1);

  await page.getByRole('button', { name: /Post & Find Flatmates/i }).click();

  // Success screen
  await expect(page.getByText(/Flatmate Listing Posted/i)).toBeVisible({ timeout: 10000 });

  // App SPA-navigates to /dashboard (Overview). Open My Listings via deep-link.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 8000 });

  /* The store write used to be read into a `console.log` behind a sleep, which is a diagnostic
     nobody reads and a race nobody notices. It is a real claim -- the post reached storage under
     this user -- so it is asserted, and `expect.poll` retries where the bare `evaluate()` could not. */
  await expect
    .poll(async () => (await page.evaluate(
      () => JSON.parse(localStorage.getItem('puneNestRoomListings') || '[]'),
    )).length)
    .toBeGreaterThan(0);

  await page.goto(`${BASE}/dashboard#listings`);

  await expect(page.getByText(SOCIETY).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Flatmate', { exact: true }).first()).toBeVisible();

  expect(errors).toHaveLength(0);
});

