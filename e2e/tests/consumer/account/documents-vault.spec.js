// @ts-check
import { test, expect } from '@playwright/test';
import { seed, publishListing, rentListing } from '../../../helpers/app.js';
import { trackErrors } from '../../../helpers/console.js';

/**
 * Dashboard → Documents vault, mock mode.
 *
 * The vault's data ops (list / upload / delete) were flipped off the direct `lib/data/documents.js`
 * calls onto the async `documentService` seam (tech-debt D124's honest-subset flip). In mock mode the
 * seam resolves to the mock provider, which wraps the same localStorage store — so the owner surface
 * must still round-trip a file end to end: upload it, see it land in its slot, remove it, see the slot
 * go empty. A synchronous-render regression here would surface as an empty vault or a console error,
 * so both are asserted.
 *
 * The live counterpart (the same round-trip against a seeded server property) lives in
 * `live-property-integration.spec.js` and runs only under the live config.
 */
const OWNER = { name: 'Vault Owner', mobile: '9800000009', email: '', role: 'owner' };
const LISTING = rentListing({
  id: 'L-VAULT-1', title: 'Vault Test 3 BHK, Baner', ownerMobile: '9800000009', status: 'approved',
});

test.describe('Documents vault (mock seam)', () => {
  test('owner uploads a document, it lands in its slot, then removes it', async ({ page }) => {
    const errors = trackErrors(page);
    // isOwner + the per-user store, then the marketplace DB so `myListings` returns the property.
    await seed(page, { user: OWNER, listings: [LISTING] });
    await publishListing(page, LISTING);
    await page.goto('/dashboard#documents', { waitUntil: 'networkidle' });

    // The vault renders in owner context, with the seeded property selectable (not the empty
    // "My portfolio" bucket).
    await expect(page.getByRole('heading', { name: 'Document Vault' })).toBeVisible();
    const ownerCtx = page.getByRole('button', { name: 'Property docs' });
    if (await ownerCtx.count()) await ownerCtx.click();

    // First Title & Ownership slot. The Title card is open by default.
    const uploadTile = page.getByRole('button', { name: 'Upload Sale Deed' });
    await expect(uploadTile).toBeVisible();

    // Uploading drives the vault's hidden file input; the seam turns the File into a stored row.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      uploadTile.click(),
    ]);
    await chooser.setFiles({ name: 'sale-deed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 vault test') });

    // The slot flips from an upload prompt to the stored file, offering Remove.
    const removeBtn = page.getByRole('button', { name: 'Remove Sale Deed' });
    await expect(removeBtn).toBeVisible();

    // Removing it takes the slot back to the upload prompt.
    await removeBtn.click();
    await expect(page.getByRole('button', { name: 'Remove Sale Deed' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Upload Sale Deed' })).toBeVisible();

    expect(errors, 'console errors during vault round-trip').toEqual([]);
  });
});
