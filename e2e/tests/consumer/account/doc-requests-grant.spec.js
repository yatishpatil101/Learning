import { test, expect } from '@playwright/test';
import { appReady } from '../../../helpers/app.js';

/* Owner grants a buyer's document request from the dashboard Leads inbox.
   This exercises the path `useDashboardData.decideDocReqs` drives — the inbox read and the
   grant now route through `documentService` (the seam), the same service `DocumentsTab` uses,
   rather than reading/writing `lib/data/documents.js` directly. Before this, the dashboard read
   the inbox from localStorage while the Documents tab read it through the seam, so in http mode
   the two disagreed and a grant issued here never reached the server. In mock mode the seam wraps
   the same store, so behaviour is unchanged and this asserts it end to end through the UI. */

const OWNER = '9530042000';
const BUYER = '9000042001';
const PROP = 'P-DOCREQ-1';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoHqA1YAAAAASUVORK5CYII=';

function seedOwnerWithPendingRequest(page) {
  return page.addInitScript(({ OWNER, BUYER, PROP, PNG }) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Owner Nilesh', mobile: OWNER, role: 'owner' }));
    localStorage.setItem('puneNestUsers', JSON.stringify([{ name: 'Owner Nilesh', mobile: OWNER, role: 'owner' }]));
    // One approved listing so the owner-gated Leads tab is available.
    localStorage.setItem('puneNestListings:' + OWNER, JSON.stringify([
      { id: PROP, title: '2 BHK Flat in Baner', status: 'approved', ownerMobile: OWNER },
    ]));
    // The owner has uploaded the two papers the buyer is asking for, so the grant matches files
    // by category and reports two shared documents.
    localStorage.setItem('puneNestDocs:' + OWNER, JSON.stringify({
      [PROP]: [
        { id: 'file-sale', category: 'Sale Deed', name: 'sale-deed.png', mime: 'image/png', dataUrl: PNG },
        { id: 'file-noc', category: 'Society NOC', name: 'society-noc.png', mime: 'image/png', dataUrl: PNG },
      ],
    }));
    // One server-shaped request carries both categories.
    localStorage.setItem('puneNestDocReq:' + OWNER, JSON.stringify([
      { id: 'r-both', propId: PROP, buyerName: 'Priya', buyerMobile: BUYER, docType: 'Sale Deed', categories: ['Sale Deed', 'Society NOC'], status: 'pending', requestedAt: Date.now() },
    ]));
  }, { OWNER, BUYER, PROP, PNG });
}

/* The owner-gated Leads tab is decided by what the property seam returns, and the seam reads the
   catalogue (`puneNestDB_v5`) filtered to `real === true` rows owned by this mobile — not the
   `puneNestListings:<mobile>` key seeded above, which stopped being the source of truth when My
   Listings was repointed at propertyService. Without this row the owner has no inventory, the
   Leads tab never renders, and the Documents sub-tab click below finds nothing.

   Post-boot, because the app seeds the catalogue itself on first load and would clobber an init
   script write. Read-modify-write the real store — never fall back to '{}', which would wipe it. */
async function ownListing(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await appReady(page);
  await page.evaluate(({ mob, propId }) => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing after appReady()');
    const db = JSON.parse(raw);
    db.listings = [
      {
        id: propId, title: '2 BHK Flat in Baner', ownerMobile: mob, real: true, status: 'approved',
        deal: 'sale', locality: 'Baner', bhk: '2 BHK', price: 9500000, createdAt: Date.now(),
      },
      ...(db.listings || []).filter((p) => p.id !== propId),
    ];
    localStorage.setItem(KEY, JSON.stringify(db));
  }, { mob: OWNER, propId: PROP });
}

test('owner grants a document request from the dashboard, through the seam', async ({ page }) => {
  await seedOwnerWithPendingRequest(page);
  await ownListing(page);
  await page.goto('/dashboard#enquiries', { waitUntil: 'networkidle' });

  // Open the "Documents" sub-tab, which lists only document requests with their category preview.
  await page.getByRole('tab', { name: /Documents/i }).click();

  // The request reads back into the Leads inbox (through documentService, grouped one lead per
  // buyer+property) — proving the dashboard now shares the Documents tab's source of truth.
  await expect(page.getByText('Priya')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Wants 2 documents: Sale Deed, Society NOC/i)).toBeVisible();

  const grantAll = page.getByRole('button', { name: /Grant all/i });
  await expect(grantAll).toBeVisible();
  await grantAll.click();

  // The grant routes through the seam; in mock mode the share ledger reports both files, so the
  // toast names the real count rather than a blanket "granted".
  await expect(page.getByRole('alert')).toContainText(/2 documents now visible to this buyer/i);

  // After the seam re-read, the group flips out of the pending state — the buttons are gone and
  // the row confirms the grant. This is the surface that used to read a stale localStorage inbox.
  await expect(page.getByRole('button', { name: /Grant all/i })).toHaveCount(0);
  await expect(page.getByText(/All granted/i)).toBeVisible();

  // The store recorded the grant with the category-matched file ids (the seam wrote through to it).
  const reqs = await page.evaluate((owner) => JSON.parse(localStorage.getItem('puneNestDocReq:' + owner) || '[]'), OWNER);
  expect(reqs.find((r) => r.id === 'r-both')?.status).toBe('granted');
  expect(reqs.find((r) => r.id === 'r-both')?.sharedDocIds).toEqual(['file-sale', 'file-noc']);
});
