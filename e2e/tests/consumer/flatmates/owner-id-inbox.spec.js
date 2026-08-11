import { test, expect } from '@playwright/test';

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

  await page.goto(`${BASE}/dashboard#enquiries`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /^Flatmate/i }).click();

  const row = page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Asha Patil' }).first();
  await expect(row).toContainText('Room enquiry');
  await expect(row).toContainText('Skyline Heights');
  await expect(row.getByRole('button', { name: /Accept/i })).toBeVisible();
});