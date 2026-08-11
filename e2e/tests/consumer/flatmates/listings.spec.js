import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

const BASE = 'http://localhost:5173';
const MOBILE = '9876543210';

// Seed an authenticated owner and a posted flatmate room (as persistFlatmate would save it).
async function seedOwnerWithRoom(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now(),
    }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({
      verified: true, aadhaarMobile: mobile, at: Date.now(),
    }));
    localStorage.setItem('puneNestRoomListings', JSON.stringify([{
      id: 'room-test-1', type: 'flatmate', owner: 'Test Owner', ownerMobile: mobile,
      bhk: '2', flatType: '2 BHK', roomType: 'Private room', furnishing: 'Semi-Furnished',
      locality: 'Baner', localities: ['Baner'], society: 'Test PG Skyline',
      rentShare: '14000', budget: 14000, deposit: 28000, gender: 'female', food: 'veg',
      tags: ['Non-smoker'], photos: [], img: '', note: 'Nice room', verified: false,
      time: 'Just now', status: 'pending', createdAt: new Date().toISOString(),
    }]));
  }, MOBILE);
}

test('Flatmates page opens without runtime errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${BASE}/flatmates`);
  /* The two view tabs render once the page mounts successfully.
     Matched on their aria-label, which is the count-bearing string ("Move in now — N homes with a
     room available") rather than the visible label. The visible label is a `<span>` beside a count
     badge, so an accessible-name match on the short label alone is brittle; the aria-label is the
     one the tab actually exposes and is what a screen reader announces. */
  await expect(page.getByRole('button', { name: /Move in now —/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Team up —/i })).toBeVisible();
  expect(errors).toHaveLength(0);
});

test('posted flatmate room appears in dashboard My Listings', async ({ page }) => {
  const errors = trackErrors(page);
  await seedOwnerWithRoom(page);
  await page.goto(`${BASE}/dashboard#listings`);

  // The flatmate listing (built from the room record) is visible with its Flatmate tag.
  await expect(page.getByText('Test PG Skyline')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Flatmate', { exact: true }).first()).toBeVisible();
  expect(errors).toHaveLength(0);
});
