import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* Map-view detail panel "Contact Owner" must match the property-detail page:
   it starts an in-app chat (sign-in + Aadhaar gates, then a pending request routed
   into /messages) â€” NOT the old number-reveal enquiry popup. */

const SEED_DB = JSON.parse(readFileSync(new URL('../../frontend/src/data/db.json', import.meta.url), 'utf-8'));
const BUYER = '9876543210';

const saleListing = {
  id: 'MAP-villa', title: '3 BHK Villa in Baner', type: 'Villa', bhk: '3 BHK', bhkNum: 3, bath: 3,
  area: 1885, locality: 'Baner', localitySlug: 'baner', loc: 'Baner, Pune', society: '', deal: 'buy',
  price: 27300000, priceStr: 'â‚¹2.73 Cr', owner: 'Seed Owner', ownerMobile: '9000000000',
  status: 'approved', statusClass: 'pill-approved', real: true, featured: false, views: 0, enquiries: 0,
  photoCount: 0, furnishing: 'furnished', facing: '', floor: 0, age: '', construction: 'ready',
  amenities: [], img: '', image: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=70',
  gallery: [], desc: '', deposit: 0, pets: false, food: 'any', rera: '', lockin: '0', notice: '1',
  available: '', tenants: '', ownerVerified: true, createdAt: '2026-12-31', viewUrl: '/property/MAP-villa',
};

async function seed(page, { aadhaar = true, signedIn = true } = {}) {
  const db = { ...SEED_DB, listings: [saleListing, ...(SEED_DB.listings || [])] };
  await page.addInitScript(
    ({ dbStr, buyer, aadhaar, signedIn }) => {
      localStorage.setItem('puneNestDB_v5', dbStr);
      localStorage.setItem('puneNest_conciergeSeeded_v1', '1');
      if (signedIn) localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Buyer', mobile: buyer, role: 'buyer', loginAt: Date.now() }));
      if (aadhaar) localStorage.setItem('puneNestAadhaar:' + buyer, JSON.stringify({ verified: true, aadhaarMobile: buyer, at: Date.now() }));
    },
    { dbStr: JSON.stringify(db), buyer: BUYER, aadhaar, signedIn },
  );
}

async function openDrawer(page) {
  await page.goto('/listings?deal=buy&view=map&loc=Baner');
  const marker = page.locator('.price-marker', { hasText: 'â‚¹2.73Cr' }).first();
  await marker.waitFor({ timeout: 20000 });
  await marker.click();
  const drawer = page.locator('.pn-mdp');
  await drawer.waitFor({ timeout: 10000 });
  return drawer;
}

test('verified buyer: Contact Owner opens the in-app chat with a pending request (no enquiry popup)', async ({ page }) => {
  await seed(page, { aadhaar: true });
  const drawer = await openDrawer(page);

  await drawer.getByRole('button', { name: /Contact Owner/i }).click();

  // Routes straight into the thread for this listing â€” no number-reveal popup.
  await expect(page).toHaveURL(/\/messages\?openProp=MAP-villa/);
  await expect(page.getByText(/Waiting for the owner to accept/i)).toBeVisible({ timeout: 10000 });
});

test('unverified buyer: Contact Owner hits the Aadhaar gate (no popup, no navigation yet)', async ({ page }) => {
  await seed(page, { aadhaar: false });
  const drawer = await openDrawer(page);

  await drawer.getByRole('button', { name: /Contact Owner/i }).click();

  // The Aadhaar verification modal appears; we stay on listings (no chat until verified).
  await expect(page.getByText(/Aadhaar/i).first()).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(/\/listings/);
});

