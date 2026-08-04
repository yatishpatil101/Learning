import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* Regression cover for the consumer "Post a property" bug fixes:
   - property-type cascade reset (stale type-specific answers are cleared)
   - the property detail page consumes the owner's REAL saved specs
     (bathrooms, furnishing, facing, age, parking, deposit) instead of
     fabricating them from BHK / price. */

const BASE = 'http://localhost:5173';
const MOBILE = '9876543210';

const SEED_DB = JSON.parse(
  readFileSync(new URL('../../../../frontend/src/data/db.json', import.meta.url), 'utf-8'),
);

function seedOwner(page) {
  return page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
}

async function injectStock(page, listings) {
  const db = { ...SEED_DB, listings: [...listings, ...(SEED_DB.listings || [])] };
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
      localStorage.setItem('puneNest_conciergeSeeded_v1', '1');
    },
    ['puneNestDB_v5', JSON.stringify(db)],
  );
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(250);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

test('switching property type clears the previous type-specific answers (cascade reset)', async ({ page }) => {
  await seedOwner(page);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });

  await pickType(page, 'PG / Hostel');
  const single = page.locator('.radio-pill', { hasText: 'Single (No Sharing)' });
  await single.click();
  await expect(single).toHaveClass(/selected/);

  // Bounce to a Flat and back â€” the PG-only sharing pick must not survive.
  await pickType(page, 'Flat / Apartment');
  await pickType(page, 'PG / Hostel');
  await expect(page.locator('.radio-pill', { hasText: 'Single (No Sharing)' })).not.toHaveClass(/selected/);
});

const buyFlat = {
  id: 'RC-flat-buy', title: '3 BHK Flat in Baner', type: 'Flat', bhk: '3', bhkNum: 3,
  bath: 3, area: 1200, locality: 'Baner', localitySlug: 'baner', loc: 'Baner, Pune',
  society: 'Skyline Heights', deal: 'buy', price: 12000000, priceStr: '₹1,20,00,000',
  owner: 'Seed Owner', ownerMobile: '9000000000', status: 'approved', statusClass: 'pill-approved',
  real: true, featured: false, views: 12, enquiries: 3, photoCount: 3,
  furnishing: 'semi', facing: 'East', floor: 5, totalFloors: 12, age: '1-5', construction: 'ready',
  parkingSpaces: 2, amenities: [], img: '', image: '', gallery: [], desc: 'Bright home', deposit: 0,
  pets: false, food: 'any', rera: '', lockin: '0', notice: '1', available: '',
  tenants: '', createdAt: Date.now(), viewUrl: '/property/RC-flat-buy',
};

test('detail page shows the ownerâ€™s real bathrooms, furnishing, facing, age and parking', async ({ page }) => {
  await injectStock(page, [buyFlat]);
  await page.goto(`${BASE}/property/RC-flat-buy`);
  await expect(page.getByRole('heading', { name: /Key Details/i })).toBeVisible({ timeout: 15000 });

  const detail = (label) => page.locator('.detail-card', { has: page.getByText(label, { exact: true }) });
  await expect(detail('Bathrooms')).toContainText('3');
  await expect(detail('Furnishing')).toContainText('Semi-Furnished');
  await expect(detail('Facing')).toContainText('East');
  await expect(detail('Parking')).toContainText('2');
  await expect(detail('Age')).toContainText('5 yrs');
  await expect(detail('Floor')).toContainText('5th of 12');
});

const rentFlat = {
  ...buyFlat, id: 'RC-flat-rent', title: '2 BHK Flat in Baner', bhk: '2', bhkNum: 2, bath: 2,
  deal: 'rent', price: 20000, priceStr: '₹20,000/mo', deposit: 45000, available: '',
  viewUrl: '/property/RC-flat-rent',
};

test('detail page shows the ownerâ€™s real deposit for a rental (not price Ã— 2)', async ({ page }) => {
  await injectStock(page, [rentFlat]);
  await page.goto(`${BASE}/property/RC-flat-rent`);
  await expect(page.getByRole('heading', { name: /Key Details/i })).toBeVisible({ timeout: 15000 });
  // The Deposit stat tile reflects the saved ₹45,000, not the ₹40,000 fallback.
  await expect(page.getByText('₹45,000').first()).toBeVisible();
});

