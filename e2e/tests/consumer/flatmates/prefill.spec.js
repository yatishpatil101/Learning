import { test, expect } from '@playwright/test';
import { postAsGroup, appReady } from '../../../helpers/app.js';
import { trackErrors } from '../../../helpers/console.js';

/* One-tap replacement posting for existing customers: attaching a property/tenancy
   PuneNest already holds prefills the group form so an owner/tenant seeking a
   replacement flatmate doesn't re-type data we own. Prefill fills only descriptive
   fields (title/locality/rent) + the known owner's number for consent — never the
   trust tier itself. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
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
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await postAsGroup(page);
}

/* The owner's picker is filled from `propertyService.myListings`, and the seam resolves that out of
   the catalogue (`puneNestDB_v5`) — rows with `real === true` and a matching `ownerMobile` — not the
   `puneNestListings:<mobile>` key `seed()` writes, which stopped being the source of truth when My
   Listings was repointed at the seam. Without a catalogue row the owner has no inventory, the modal
   renders "you have not listed a property yet", and the attach button these tests click is absent.

   Post-boot, because the app seeds the catalogue itself on first load and would clobber an
   `addInitScript` write. Read-modify-write the real store; never fall back to '{}', which would
   discard every other row and take the public feed down with it. */
async function ownListing(page, listing) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await appReady(page);
  await page.evaluate(({ mob, l }) => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing after appReady()');
    const db = JSON.parse(raw);
    db.listings = [
      { ...l, ownerMobile: mob, real: true, createdAt: Date.now() },
      ...(db.listings || []).filter((p) => p.id !== l.id),
    ];
    localStorage.setItem(KEY, JSON.stringify(db));
  }, { mob: MOBILE, l: listing });
}

test('owner: attaching a verified rent listing prefills title, locality and rent', async ({ page }) => {
  const errors = trackErrors(page);
  const listing = { id: 'p777', title: 'My 2BHK, Baner', locality: 'Baner', status: 'verified', deal: 'rent', price: 38000, bhk: '2 BHK' };
  await seed(page, { listings: [listing] });
  await ownListing(page, listing);
  await openGroupModal(page);
  await page.getByRole('button', { name: /Flat owner/i }).click();
  await page.getByRole('button', { name: /Attach a verified property/i }).click();
  await page.getByRole('option', { name: 'My 2BHK, Baner' }).click();

  await expect(page.getByPlaceholder(/2 girls/i)).toHaveValue(/1 more flatmate for a 2 BHK in Baner/i);
  await expect(page.getByPlaceholder(/e\.g\. 34000/i)).toHaveValue('38000');
  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('owner: a sale listing prefills title but not rent (a sale price is not a monthly rent)', async ({ page }) => {
  const listing = { id: 'p778', title: 'My plot, Wakad', locality: 'Wakad', status: 'verified', deal: 'buy', price: 5000000 };
  await seed(page, { listings: [listing] });
  await ownListing(page, listing);
  await openGroupModal(page);
  await page.getByRole('button', { name: /Flat owner/i }).click();
  await page.getByRole('button', { name: /Attach a verified property/i }).click();
  await page.getByRole('option', { name: 'My plot, Wakad' }).click();

  await expect(page.getByPlaceholder(/2 girls/i)).toHaveValue(/1 more flatmate in Wakad/i);
  await expect(page.getByPlaceholder(/e\.g\. 34000/i)).toHaveValue('');
});

test('tenant: prefill from a PuneNest tenancy fills the form and enables owner consent', async ({ page }) => {
  const errors = trackErrors(page);
  /* The tenancy row carries the property's id and nothing else about it, which is why the flat has
     to exist in the catalogue for the picker to name it — see `toRentalCards`. `real: true` because
     the demo rows are excluded from every owner's inventory, and this one belongs to the landlord. */
  const flat = { id: 'p900', title: '2 BHK Flat in Wakad', locality: 'Wakad', address: 'Wakad, Pune', bhk: '2 BHK', deal: 'rent', price: 32000, status: 'approved' };
  await seed(page, { tenancies: [{ id: 'tn1', propId: 'p900', rent: 32000, ownerMobile: '9800011122', ownerName: 'Landlord', deal: 'rent', status: 'active' }] });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await appReady(page);
  await page.evaluate((l) => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing after appReady()');
    const db = JSON.parse(raw);
    db.listings = [
      { ...l, ownerMobile: '9800011122', real: true, createdAt: Date.now() },
      ...(db.listings || []).filter((p) => p.id !== l.id),
    ];
    localStorage.setItem(KEY, JSON.stringify(db));
  }, flat);
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
