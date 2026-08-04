import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* Listings "Map view" marker interaction. On the listings map, clicking a price
   marker no longer opens a leaflet popup â€” it opens the slide-in Map Detail Panel
   (`.pn-mdp`), a compact, richer clone of the property tile. (The old leaflet popup
   now only exists on the property-page mini-map, which passes no `onSelect`.)

   Regression guard: the listings map must open the drawer, never a `.leaflet-popup`. */

const SEED_DB = JSON.parse(readFileSync(new URL('../../../../frontend/src/data/db.json', import.meta.url), 'utf-8'));

/* An approved sale listing shaped like the post-a-property flow persists one, with
   a distinctive price so its marker label is easy to target. */
const saleListing = {
  id: 'MAP-villa', title: '3 BHK Villa in Baner', type: 'Villa', bhk: '3 BHK', bhkNum: 3, bath: 3,
  area: 1885, locality: 'Baner', localitySlug: 'baner', loc: 'Baner, Pune', society: '', deal: 'buy',
  price: 27300000, priceStr: '₹2.73 Cr', owner: 'Seed Owner', ownerMobile: '9000000000',
  status: 'approved', statusClass: 'pill-approved', real: true, featured: false, views: 0, enquiries: 0,
  photoCount: 0, furnishing: 'furnished', facing: '', floor: 0, age: '', construction: 'ready',
  amenities: [], img: '', image: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=70',
  gallery: [], desc: '', deposit: 0, pets: false, food: 'any', rera: '', lockin: '0', notice: '1',
  available: '', tenants: '', ownerVerified: true, createdAt: '2026-12-31', viewUrl: '/property/MAP-villa',
};

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

test('clicking a map marker opens the detail drawer, not a leaflet popup', async ({ page }) => {
  await injectStock(page, [saleListing]);
  // The map is area-first: it only renders once 1â€“5 localities are focused, so we
  // deep-link the villa's locality (?loc=Baner) to un-gate it before asserting.
  await page.goto('/listings?deal=buy&view=map&loc=Baner');

  // Target the villa's distinctive marker (₹2.73Cr) rather than .first() â€” markers can
  // overlap on the map and an adjacent pin would intercept the click.
  const marker = page.locator('.price-marker', { hasText: '₹2.73Cr' }).first();
  await marker.waitFor({ timeout: 20000 });
  await marker.click();

  const drawer = page.locator('.pn-mdp');
  await drawer.waitFor({ timeout: 10000 });

  // The listings map opens the drawer â€” no map InfoWindow popup must appear.
  await expect(page.locator('.pn-gm-iw-prop')).toHaveCount(0);

  // Same building blocks as the standard tile, richer.
  await expect(drawer.locator('.pn-mdp-deal')).toHaveText(/For Rent|For Sale/);
  await expect(drawer.locator('.pn-mdp-price')).toContainText('₹');
  await expect(drawer.locator('.pn-mdp-loc')).toContainText('Pune');
  // "Open full page" links to a real property page.
  await expect(drawer.locator('.pn-mdp-full')).toHaveAttribute('href', /^\/property\//);
});

test('map drawer reflects the marked property (title, price + facts match the pin)', async ({ page }) => {
  await injectStock(page, [saleListing]);
  await page.goto('/listings?deal=buy&view=map&loc=Baner');
  // The injected villa's marker label is ₹2.73Cr (27300000 / 1e7, sale â‰¥ 1 Cr).
  const marker = page.locator('.price-marker', { hasText: '₹2.73Cr' }).first();
  await marker.waitFor({ timeout: 20000 });
  await marker.click();

  const drawer = page.locator('.pn-mdp');
  await drawer.waitFor({ timeout: 10000 });

  await expect(drawer.locator('.pn-mdp-full')).toHaveAttribute('href', '/property/MAP-villa');
  await expect(drawer.locator('.pn-mdp-title')).toHaveText('3 BHK Villa');
  await expect(drawer.locator('.pn-mdp-price')).toContainText('₹2.73 Cr');

  // Facts come from the real listing fields â€” 3 bedrooms, real baths (3), area.
  const facts = drawer.locator('.pn-mdp-fact');
  await expect(facts.filter({ hasText: '3 Bed' })).toHaveCount(1);
  await expect(facts.filter({ hasText: '3 Bath' })).toHaveCount(1);
  await expect(facts.filter({ hasText: '1,885 sq.ft' })).toHaveCount(1);
});

