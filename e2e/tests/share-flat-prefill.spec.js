import { test, expect } from '@playwright/test';

/* One-tap replacement posting for existing customers: attaching a property/tenancy
   PuneNest already holds prefills the group form so an owner/tenant seeking a
   replacement flatmate doesn't re-type data we own. Prefill fills only descriptive
   fields (title/locality/rent) + the known owner's number for consent — never the
   trust tier itself. */

const BASE = 'http://localhost:5173';
const MOBILE = '9820011122';

async function seed(page, { listings = null, tenancies = null } = {}) {
  await page.addInitScript(({ m, l, t }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Existing Customer', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    if (l) localStorage.setItem('puneNestListings:' + m, JSON.stringify(l));
    if (t) localStorage.setItem('pnTenancies:' + m, JSON.stringify(t));
  }, { m: MOBILE, l: listings, t: tenancies });
}

async function openGroupModal(page) {
  await page.goto(`${BASE}/share-flat?view=groups`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /Create a group/i }).click();
}

test('owner: attaching a verified rent listing prefills title, locality and rent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seed(page, { listings: [{ id: 'p777', title: 'My 2BHK, Baner', locality: 'Baner', status: 'verified', deal: 'rent', price: 38000, bhk: '2 BHK' }] });
  await openGroupModal(page);
  await page.getByRole('button', { name: /Flat owner/i }).click();
  await page.getByRole('button', { name: /Attach a verified property/i }).click();
  await page.getByRole('option', { name: 'My 2BHK, Baner' }).click();

  await expect(page.getByPlaceholder(/2 girls/i)).toHaveValue(/1 more flatmate for a 2 BHK in Baner/i);
  await expect(page.getByPlaceholder(/e\.g\. 34000/i)).toHaveValue('38000');
  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('owner: a sale listing prefills title but not rent (a sale price is not a monthly rent)', async ({ page }) => {
  await seed(page, { listings: [{ id: 'p778', title: 'My plot, Wakad', locality: 'Wakad', status: 'verified', deal: 'buy', price: 5000000 }] });
  await openGroupModal(page);
  await page.getByRole('button', { name: /Flat owner/i }).click();
  await page.getByRole('button', { name: /Attach a verified property/i }).click();
  await page.getByRole('option', { name: 'My plot, Wakad' }).click();

  await expect(page.getByPlaceholder(/2 girls/i)).toHaveValue(/1 more flatmate in Wakad/i);
  await expect(page.getByPlaceholder(/e\.g\. 34000/i)).toHaveValue('');
});

test('tenant: prefill from a PuneNest tenancy fills the form and enables owner consent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seed(page, { tenancies: [{ id: 'tn1', propId: 'p900', title: '2 BHK Flat in Wakad', address: 'Wakad, Pune', rent: 32000, ownerMobile: '9800011122', ownerName: 'Landlord', deal: 'rent', status: 'active' }] });
  await openGroupModal(page);
  // Default role is "Current tenant" → the tenancy picker is present.
  await page.getByRole('button', { name: /Prefill from your PuneNest tenancy/i }).click();
  await page.getByRole('option', { name: '2 BHK Flat in Wakad' }).click();

  await expect(page.getByPlaceholder(/2 girls/i)).toHaveValue(/1 more flatmate in Wakad/i);
  await expect(page.getByPlaceholder(/e\.g\. 34000/i)).toHaveValue('32000');
  await expect(page.getByPlaceholder(/seeking a replacement/i)).toHaveValue('9800011122');
  // Owner's number is known → the consent-OTP step is one tap (button enabled).
  await expect(page.getByRole('button', { name: /Verify owner consent via OTP/i })).toBeEnabled();
  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('tenant: no tenancy on record → the prefill picker is not shown', async ({ page }) => {
  await seed(page);
  await openGroupModal(page);
  await expect(page.getByRole('button', { name: /Prefill from your PuneNest tenancy/i })).toHaveCount(0);
});
