import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';
const MOBILE = '9876543210';

/* Seed a verified owner and, optionally, an existing approved listing. Aadhaar is
   pre-seeded so the posting form (or the paywall / edit banner) is what we land on,
   not the identity gate. */
async function seedOwner(page, { listings = [] } = {}) {
  await page.addInitScript(({ mobile, listings }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now(),
    }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({
      verified: true, aadhaarMobile: mobile, at: Date.now(),
    }));
    if (listings.length) {
      localStorage.setItem('puneNestListings:' + mobile, JSON.stringify(listings));
    }
  }, { mobile: MOBILE, listings });
}

const LIVE_LISTING = {
  id: 'L1',
  title: '2 BHK Flat in Baner',
  status: 'approved',
  statusClass: 'pill-approved',
  deal: 'buy',
  type: 'Flat',
  locality: 'Baner',
  price: 5000000,
  gallery: ['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80'],
  form: {
    deal: 'buy', propertyType: 'flat', bhk: '2', bathrooms: '2',
    carpetArea: '900', locality: 'Baner', society: 'Green Acres',
    price: '5000000', description: 'Bright 2 BHK', furnishing: 'unfurnished',
  },
};

const formLocator = (page) => page.locator('[data-err="propertyType"]');

test('a first free listing is NOT paywalled and shows no edit banner', async ({ page }) => {
  await seedOwner(page); // no existing listings
  await page.goto(`${BASE}/list-property`);
  await expect(formLocator(page)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/used your free listing/i)).toHaveCount(0);
  await expect(page.getByText(/editing a live listing/i)).toHaveCount(0);
});

test('P2 — a second new listing is paywalled on the free plan', async ({ page }) => {
  await seedOwner(page, { listings: [LIVE_LISTING] });
  await page.goto(`${BASE}/list-property`);
  // The paywall replaces the form once the free quota is used.
  await expect(page.getByRole('heading', { name: /used your free listing/i })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('link', { name: /Upgrade & post/i })).toBeVisible();
  await expect(formLocator(page)).toHaveCount(0);
});

test('P1 — editing a live listing shows the tiered edit banner (and no paywall)', async ({ page }) => {
  await seedOwner(page, { listings: [LIVE_LISTING] });
  await page.goto(`${BASE}/list-property?edit=L1`);

  // The edit-policy banner explains the two tiers …
  await expect(page.getByRole('heading', { name: /editing a live listing/i })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Publishes instantly')).toBeVisible();
  await expect(page.getByText('Needs a quick re-check')).toBeVisible();

  // … editing an existing listing is never paywalled, and the form is available.
  await expect(page.getByText(/used your free listing/i)).toHaveCount(0);
  await expect(formLocator(page)).toBeVisible();
});

test('P1 — a Tier-A edit surfaces the re-check summary + status timeline', async ({ page }) => {
  await seedOwner(page, { listings: [LIVE_LISTING] });
  await page.goto(`${BASE}/list-property?edit=L1`);
  await expect(page.getByRole('heading', { name: /editing a live listing/i })).toBeVisible({ timeout: 10000 });

  // Change BHK (a Tier-A / material field) from 2 → 3 on step 1.
  await page.locator('[data-err="bhk"]').getByText('3', { exact: true }).click();

  // The live summary flags a re-check and the "stays live" timeline appears.
  await expect(page.getByText(/need a re-check/i)).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('Update under review')).toBeVisible();
});
