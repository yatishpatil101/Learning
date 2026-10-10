// @ts-check
import { test, expect } from '@playwright/test';
import { MOBILE } from '../../../helpers/rentAgreementWizard.js';
/* Mock-only: the server-side spend (once, statutory charges still billed, race-safe) is pinned by
   RentAgreementReferralCreditTest and ReferralCreditRaceTest. This pins what the wizard shows. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const BUYER = { name: 'Anita Verma', mobile: MOBILE.owner, email: '', role: 'buyer', joinedAt: Date.now() };
const PROP = { propType: 'Flat / Apartment', furnish: 'Unfurnished', flatNo: 'B-1204', society: 'Skyline Heights', locality: 'Baner', gramPanchayat: false, city: 'Pune', taluka: 'Haveli', villageCity: 'Baner', pincode: '411045', area: '' };
const TERMS = { startDate: '', months: '11', rent: '20000', deposit: '100000', nrDeposit: '', increment: '5', lockin: '6', notice: '2', dueDay: '5', payMode: 'Bank Transfer / NEFT' };

const rupees = (text) => Number(String(text).replace(/[^\d]/g, ''));

test('a free rent agreement from referrals strikes the Draazy fee and GST but keeps government charges', async ({ page }) => {
  let remaining = 0;
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BUYER) }));
  await page.route('**/api/auth/refresh', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'e2e-nobackend-token' }) }));
  await page.route('**/api/fees', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ deal: 'rent', brokerage: 0, platformFee: 1999, stampDuty: null, registration: null, gst: 360, notes: null }]),
  }));
  await page.route('**/api/me/entitlements', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      contacts: { limit: 5, used: 0, bonus: 0, plan: 'free' },
      listings: { limit: 1, bonus: 0, held: 0 },
      agreements: { free: 1, used: 1 - remaining, remaining },
    }),
  }));
  await page.addInitScript(([u, draft]) => {
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: false, analytics: false, marketing: false, version: 1, ts: Date.now() }));
    localStorage.setItem('draazyUser', JSON.stringify(u));
    localStorage.setItem('draazyTokens', JSON.stringify({ accessToken: 'e2e-nobackend-token' }));
    localStorage.setItem('dzDraft:rentAgreement', JSON.stringify(draft));
  }, [BUYER, { step: 3, prop: PROP, tenantMode: 'fill', terms: TERMS }]);

  const total = page.locator('div.flex.justify-between.items-center', { hasText: /Estimated Total|Total Payable/ }).first();
  const fee = page.locator('div.flex.justify-between', { hasText: 'Draazy Service Fee' }).first();
  const waiver = page.getByText(/Free with your referral reward/).first();

  await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
  await expect(total).toContainText('₹');
  await expect(waiver, 'no credit, no waiver line').toHaveCount(0);
  const fullTotal = rupees(await total.locator('span').last().textContent());

  remaining = 1;
  await page.reload({ waitUntil: 'networkidle' });
  await expect(waiver).toContainText('₹2,359');
  await expect(fee.locator('span').last(), 'the Draazy fee is struck through, not hidden').toHaveClass(/line-through/);
  await expect.poll(async () => rupees(await total.locator('span').last().textContent()),
    'only the Draazy fee and its GST come off').toBe(fullTotal - 2359);
});
