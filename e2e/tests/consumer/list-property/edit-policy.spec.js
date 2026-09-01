import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
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

/**
 * Put the seeded listing where the *quota* looks, which is not where the *editor* looks.
 *
 * `seedOwner` writes `puneNestListings:<mobile>`, and that is still right for the edit tests —
 * `?edit=L1` resolves the draft straight out of that key. The paywall no longer reads it: the
 * wizard asks the property service how many listings the owner has, and on this build that is the
 * mock marketplace DB. So an owner can be simultaneously "editing L1" and "has posted nothing",
 * which is exactly the split this helper closes for the one test that measures the ceiling.
 *
 * It has to run after boot. The DB seeds itself from db.json on first load, so writing the key
 * beforehand would leave a partial catalogue behind and white-screen the wizard.
 */
async function publishToCatalogue(page, listing) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.pnBoot === 'ready', null, { timeout: 30000 });
  await page.evaluate(({ l, mobile }) => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing');
    const db = JSON.parse(raw);
    db.listings = [{ ...l, ownerMobile: mobile, real: true }, ...(db.listings || []).filter((p) => p.id !== l.id)];
    localStorage.setItem(KEY, JSON.stringify(db));
  }, { l: listing, mobile: MOBILE });
}

test('a first free listing is NOT paywalled and shows no edit banner', async ({ page }) => {
  await seedOwner(page); // no existing listings
  await page.goto(`${BASE}/list-property`);
  await expect(formLocator(page)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/used your free listing/i)).toHaveCount(0);
  await expect(page.getByText(/editing a live listing/i)).toHaveCount(0);
});

test('P2 — a second new listing is paywalled on the free plan', async ({ page }) => {
  await seedOwner(page, { listings: [LIVE_LISTING] });
  await publishToCatalogue(page, LIVE_LISTING);
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
  await expect(page.getByText('Needs a re-check')).toBeVisible();

  // … editing an existing listing is never paywalled, and the form is available.
  await expect(page.getByText(/used your free listing/i)).toHaveCount(0);
  await expect(formLocator(page)).toBeVisible();
});

test('P1 — a Tier-A edit surfaces the re-check summary + status timeline', async ({ page }) => {
  await seedOwner(page, { listings: [LIVE_LISTING] });
  await page.goto(`${BASE}/list-property?edit=L1`);
  await expect(page.getByRole('heading', { name: /editing a live listing/i })).toBeVisible({ timeout: 10000 });

  // Change BHK from 2 → 3 on step 1. BHK is one of the four fields that set
  // `remoderationRequired` in ListingEditRules.apply, so the server takes the listing down.
  await page.locator('[data-err="bhk"]').getByText('3', { exact: true }).click();

  // The live summary flags a re-check …
  await expect(page.getByText(/need a re-check/i)).toBeVisible({ timeout: 8000 });

  // … and, because this is a field buyers search on, says so: the listing comes OFF
  // SEARCH rather than staying live. Asserting the plain "Update under review" chip here
  // is what let the banner drift — it renders for both outcomes, so it cannot tell the
  // owner-visible difference between an edit that keeps the listing earning and one that
  // takes it down.
  await expect(page.getByText(/comes off search while we re-check it/i)).toBeVisible();
  await expect(page.getByText('Under review — off search')).toBeVisible();
});

test('P1 — a price edit is re-checked but the banner promises the listing stays live', async ({ page }) => {
  await seedOwner(page, { listings: [LIVE_LISTING] });
  await page.goto(`${BASE}/list-property?edit=L1`);
  await expect(page.getByRole('heading', { name: /editing a live listing/i })).toBeVisible({ timeout: 10000 });

  // Price sets `recheckOnly` rather than `remoderationRequired` in ListingEditRules.apply (Q14): a
  // cheaper 2 BHK is still the same 2 BHK, so the listing keeps earning while staff confirm the
  // number. This test is the complement of the one above and the pair is the point — the previous
  // banner said "comes off search" for both, which is a broken promise in one direction and a
  // deterrent against honest price cuts in the other.
  //
  // Price lives on step 2; the banner renders above the wizard on every step, so advancing does not
  // change what is being asserted. Step 1 is already valid from the seeded listing.
  await page.getByRole('button', { name: /Next Step/i }).click();
  const price = page.locator('input[data-err="price"]');
  await expect(price).toBeVisible({ timeout: 10000 });
  await price.fill('4500000');
  await price.blur();

  // Still a re-check — a price edit is not free …
  await expect(page.getByText(/need a re-check/i)).toBeVisible({ timeout: 8000 });

  // … but the owner is told the listing keeps working, and the off-search copy must NOT appear.
  await expect(page.getByText(/stays live and searchable while we re-check/i)).toBeVisible();
  await expect(page.getByText('Live — being re-checked')).toBeVisible();
  await expect(page.getByText(/comes off search while we re-check it/i)).toHaveCount(0);
  await expect(page.getByText('Under review — off search')).toHaveCount(0);
});
