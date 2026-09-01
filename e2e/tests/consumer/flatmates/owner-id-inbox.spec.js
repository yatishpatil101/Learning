import { test, expect } from '@playwright/test';
import { appReady } from '../../../helpers/app.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test('flatmate host inbox reads the ownerId bucket instead of the mobile bucket', async ({ page }) => {
  await page.addInitScript(() => {
    const owner = { id: 'U-flat-owner', name: 'Owner Test', mobile: '9811122233', role: 'owner', loginAt: Date.now() };
    localStorage.setItem('puneNestUser', JSON.stringify(owner));
    localStorage.setItem('puneNestUsers', JSON.stringify([owner]));
    localStorage.setItem('puneNestAadhaar:' + owner.mobile, JSON.stringify({ verified: true, aadhaarMobile: owner.mobile, at: Date.now() }));
    localStorage.setItem('puneNestListings:' + owner.mobile, JSON.stringify([
      { id: 'L-TEST-1', title: 'Owner Listing', status: 'approved', real: true, ownerMobile: owner.mobile },
    ]));
    localStorage.setItem('puneNestFlatmateReq:' + owner.id, JSON.stringify([{
      id: 'sfr1',
      kind: 'room',
      action: 'request',
      targetId: 'room-1',
      targetTitle: 'Skyline Heights',
      locality: 'Baner',
      requesterName: 'Asha Patil',
      requesterMobile: '9000000009',
      status: 'pending',
      requestedAt: Date.now() - 3600000,
    }]));
  });

  /* The owner-gated Enquiries tab is decided by what the property seam returns, and that reads the
     catalogue (`puneNestDB_v5`) rather than the `puneNestListings:<mobile>` key seeded above — the
     key stopped being the source of truth when My Listings was repointed at the seam. Without a
     catalogue row the owner has no inventory and the Flatmate sub-tab is never rendered.

     Post-boot, because the app seeds the catalogue itself on first load and would clobber an
     init-script write. Read-modify-write the real store; never fall back to '{}'. */
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await appReady(page);
  await page.evaluate(() => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing after appReady()');
    const db = JSON.parse(raw);
    db.listings = [
      {
        id: 'L-TEST-1', title: 'Owner Listing', status: 'approved', real: true,
        ownerMobile: '9811122233', deal: 'rent', locality: 'Baner', bhk: '2 BHK',
        price: 30000, createdAt: Date.now(),
      },
      ...(db.listings || []).filter((p) => p.id !== 'L-TEST-1'),
    ];
    localStorage.setItem(KEY, JSON.stringify(db));
  });

  await page.goto(`${BASE}/dashboard#enquiries`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /^Flatmate/i }).click();

  const row = page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Asha Patil' }).first();
  await expect(row).toContainText('Room enquiry');
  await expect(row).toContainText('Skyline Heights');
  await expect(row.getByRole('button', { name: /Accept/i })).toBeVisible();

  /* Accepting is asserted here, not just the render, because the decision handler became async when
     this inbox moved onto the service seam. A rendered row proves only the read; a handler that
     silently dropped the write would leave this spec green while no host could answer anyone —
     which is exactly how the photo-request resolve shipped broken. */
  await row.getByRole('button', { name: /Accept/i }).click();
  await expect(row.getByRole('button', { name: /Accept/i })).toBeHidden();
  await expect(row).toContainText(/Accepted/i);
});