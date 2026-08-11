// @ts-check
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const OWNER = { name: 'Owner Test', mobile: '9800000001', email: '', role: 'owner', joinedAt: Date.now() };
const LISTING = {
  id: 'L-TEST-1', title: 'Test 2 BHK, Baner', locality: 'Baner', deal: 'rent',
  price: 25000, status: 'approved', real: true, ownerMobile: OWNER.mobile, views: 7,
};

test('pending owner contact requests keep the Serious Buyer badge before approval', async ({ page }) => {
  await page.addInitScript(({ owner, listing, requestedAt }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(owner));
    localStorage.setItem('puneNestUsers', JSON.stringify([owner]));
    localStorage.setItem('puneNestListings:' + owner.mobile, JSON.stringify([listing]));
    localStorage.setItem('puneNestContactReq:' + owner.mobile, JSON.stringify([{
      id: 'c-verified',
      propId: listing.id,
      buyerName: 'Asha Patil',
      buyerMobile: '9000000009',
      status: 'pending',
      requestedAt,
    }]));
    localStorage.setItem('pnTenantProfile:9000000009', JSON.stringify({ idVerified: true, updatedAt: requestedAt }));
  }, { owner: OWNER, listing: LISTING, requestedAt: Date.now() - 3600000 });

  await page.goto(`${BASE}/dashboard#enquiries`, { waitUntil: 'networkidle' });

  const allLead = page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Asha Patil' }).first();
  await expect(allLead).toContainText('Serious Buyer');
  await expect(allLead).toContainText('Number request');

  await page.getByRole('tab', { name: /^Number requests/i }).click();
  const numberRow = page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Asha Patil' }).first();
  await expect(numberRow).toContainText('Serious Buyer');
  await expect(numberRow).toContainText('Requested your number');
});