import { test, expect } from '@playwright/test';
import { ownerMobileOf } from '../../../helpers/app.js';

/* "Request more photos" is a real demand signal now:
   - Buyer taps "More photos" on a listing → a request is persisted, keyed to the
     owner, and a truthful toast fires. A repeat tap is a no-op (de-duped).
   - The owner sees who asked under Dashboard → Enquiries → "Photo requests",
     with an "Add photos" CTA deep-linking to edit that listing. */

const PROP_ID = 'P5000';           // approved rent listing
const OWNER_MOBILE = ownerMobileOf('P5000'); // read from properties.json, never copied
const BUYER = { name: 'Test Buyer', mobile: '9000000001', role: 'buyer' };

test('buyer request persists + de-dupes, owner sees it under Enquiries', async ({ page }) => {
  // --- Buyer side: sign in and ask for more photos on P5000 ---
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
  }, BUYER);
  await page.goto(`/property/${PROP_ID}`, { waitUntil: 'networkidle' });

  const tile = page.getByRole('button', { name: /More photos/i });
  await tile.waitFor({ state: 'visible', timeout: 15000 });
  await tile.click();
  await expect(page.getByRole('alert')).toContainText(/owner will see it/i);

  // Persisted under the owner's key with the buyer's identity
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem('puneNestPhotoReq:' + k) || '[]'), OWNER_MOBILE);
  expect(stored.length).toBe(1);
  expect(stored[0].buyerMobile).toBe(BUYER.mobile);
  expect(stored[0].propId).toBe(PROP_ID);

  // De-dupe: a second tap does not create a duplicate
  await expect(page.getByRole('alert')).toBeHidden({ timeout: 6000 }); // first toast auto-dismisses
  await tile.click();
  await expect(page.getByRole('alert')).toContainText(/already asked/i);
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem('puneNestPhotoReq:' + k) || '[]'), OWNER_MOBILE);
  expect(after.length).toBe(1);
});

test('owner sees photo requests card with Add-photos CTA', async ({ page }) => {
  const owner = { name: 'Rohan Kulkarni', mobile: OWNER_MOBILE, role: 'owner' };
  await page.addInitScript((o) => {
    localStorage.setItem('puneNestUser', JSON.stringify(o.owner));
    // one listing so the owner-gated Enquiries tab is available
    localStorage.setItem('puneNestListings:' + o.owner.mobile, JSON.stringify([
      { id: o.propId, title: '4 BHK Villa in Magarpatta', status: 'approved' },
    ]));
    // a pending photo request from a buyer
    localStorage.setItem('puneNestPhotoReq:' + o.owner.mobile, JSON.stringify([
      { id: 'ph1', propId: o.propId, propLabel: '4 BHK Villa for Rent in Magarpatta', buyerName: 'Asha Patil', buyerMobile: '9000000009', requestedAt: Date.now() },
    ]));
  }, { owner, propId: PROP_ID });

  await page.goto('/dashboard#enquiries', { waitUntil: 'networkidle' });

  // Leads is now split into sub-tabs; open the "Photo requests" sub-tab.
  await page.getByRole('tab', { name: /Photo requests/i }).click();

  const card = page.locator('text=Photo requests').first();
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await expect(page.getByText('Asha Patil')).toBeVisible();
  await expect(page.getByText(/Wants more photos/i)).toBeVisible();

  const cta = page.getByRole('link', { name: /Add photos/i });
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', new RegExp(`/list-property\\?edit=${PROP_ID}`));
});
