// @ts-check
import { test, expect } from '@playwright/test';
import { appReady } from '../../../helpers/app.js';

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

  /* The Enquiries tab only exists for an owner, and ownership is `myListings().length > 0` — which
     resolves the catalogue (`puneNestDB_v5`) through the property seam, not the
     `puneNestListings:<mobile>` key seeded above. That key is left in place because it is still
     what the listing *editor* reads; it is simply no longer what makes someone an owner. Published
     after boot, since the app seeds the catalogue itself on first load. */
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await appReady(page);
  await page.evaluate(({ l, m }) => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing after appReady()');
    const db = JSON.parse(raw);
    db.listings = [{ ...l, ownerMobile: m, real: true }, ...(db.listings || []).filter((p) => p.id !== l.id)];
    localStorage.setItem(KEY, JSON.stringify(db));
  }, { l: LISTING, m: OWNER.mobile });

  await page.goto(`${BASE}/dashboard#enquiries`, { waitUntil: 'networkidle' });

  const allLead = page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Asha Patil' }).first();
  await expect(allLead).toContainText('Serious Buyer');
  await expect(allLead).toContainText('Number request');

  await page.getByRole('tab', { name: /^Number requests/i }).click();
  const numberRow = page.locator('div.group.relative.rounded-xl').filter({ hasText: 'Asha Patil' }).first();
  await expect(numberRow).toContainText('Serious Buyer');
  await expect(numberRow).toContainText('Requested your number');
});