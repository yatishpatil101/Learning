import { test, expect } from '../../../fixtures/base.js';

// Owner-Hub property passport (/owner-hub/property/:id).
//
// Behaviour verified from: pages/consumer/PropertyPassport.jsx (owner-only, wrapped
// in ProtectedRoute in App.jsx -> /signin?next= when signed out), the managed-property
// store lib/data/managedProperty.js (records live under `puneNestManagedProps:<mobile>`
// and getManagedProp reads them per signed-in user), owner-hub/helpers.js (passport
// completeness), owner-hub/DocVault.jsx ("Document passport") and RentPanel.jsx
// ("Rent tracking").
//
// login.asOwner() seeds the demo owner (mobile 9876500002); we seed one managed
// property under that owner's key so the passport has something to render.
const OWNER_MOBILE = '9876500002';
const PROP_ID = 'MP-e2e-passport';

const MANAGED_PROP = {
  id: PROP_ID,
  visibility: 'private',
  status: 'managed',
  source: 'owner-hub',
  real: true,
  title: '2 BHK Flat in Baner',
  type: 'Flat',
  bhk: '2 BHK',
  bhkNum: 2,
  locality: 'Baner',
  localitySlug: 'baner',
  society: '',
  loc: 'Baner, Pune',
  area: 950,
  areaUnit: 'sqft',
  furnishing: 'semi',
  deal: 'rent',
  price: 28000,
  priceStr: '₹28,000/mo',
  img: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70',
  image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70',
  gallery: [],
  owner: 'Test Owner',
  ownerMobile: OWNER_MOBILE,
  rented: false,
  tenantName: '',
  monthlyRent: 28000,
  dueDay: 5,
  valuation: { rent: { mid: 28000 }, sale: { mid: 6500000 }, perSqft: 6800 },
  publishedListingId: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

async function seedManagedProp(page) {
  await page.addInitScript(({ mobile, rec }) => {
    localStorage.setItem('puneNestManagedProps:' + mobile, JSON.stringify([rec]));
  }, { mobile: OWNER_MOBILE, rec: MANAGED_PROP });
}

test.describe('Property passport — /owner-hub/property/:id', () => {
  test('redirects to sign in when signed out', async ({ page }) => {
    await page.goto(`/owner-hub/property/${PROP_ID}`);
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
    // The passport must not render for a signed-out visitor.
    await expect(page.getByText('Passport completeness')).toHaveCount(0);
  });

  test('renders the passport for the owning user', async ({ page, login }) => {
    await login.asOwner();
    await seedManagedProp(page);
    await seedConsent(page);
    await page.goto(`/owner-hub/property/${PROP_ID}`);

    // Header: title, private status, publish CTA.
    await expect(page.getByRole('heading', { name: '2 BHK Flat in Baner' })).toBeVisible();
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Publish as listing/i })).toBeVisible();

    // Completeness meter: basics + furnishing + valuation + occupancy done (docs missing) = 80%.
    await expect(page.getByText('Passport completeness')).toBeVisible();
    await expect(page.getByText('80%')).toBeVisible();

    // Passport sections.
    await expect(page.getByRole('heading', { name: 'Document passport' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rent tracking' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Valuation' })).toBeVisible();

    // Back link to the properties hub.
    await expect(page.getByRole('link', { name: /My properties/i }).first()).toBeVisible();
  });

  test('shows a not-found state for an unknown property id', async ({ page, login }) => {
    await login.asOwner();
    await seedConsent(page);
    await page.goto('/owner-hub/property/MP-does-not-exist');

    await expect(page.getByRole('heading', { name: 'Property not found' })).toBeVisible();
    await expect(page.getByText('It may have been removed, or the link is incorrect.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to My properties/i })).toBeVisible();
  });

  test('the passport loads with no real console errors', async ({ page, login, consoleErrors }) => {
    await login.asOwner();
    await seedManagedProp(page);
    await seedConsent(page);
    await page.goto(`/owner-hub/property/${PROP_ID}`);
    await expect(page.getByRole('heading', { name: '2 BHK Flat in Baner' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
