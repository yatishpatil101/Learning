// @ts-check
import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const TENANT = { name: 'Tenant Test', mobile: '9700000055', email: '', role: 'user', joinedAt: Date.now() };

/* A YYYY-MM key n whole months before now. */
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

async function loginTenant(page, { withRental = true } = {}) {
  const mob = TENANT.mobile;
  const rent = 28000;
  const start = new Date(); start.setMonth(start.getMonth() - 3);
  const end = new Date(start); end.setMonth(end.getMonth() + 11);
  const lease = (dd) => dd.getFullYear() + '-' + ('0' + (dd.getMonth() + 1)).slice(-2) + '-01';
  const tenancy = {
    id: 'tn-test', tenantMobile: mob, ownerMobile: '9820011234', ownerName: 'Rahul Deshmukh',
    propId: 'PN-RENT-TEST', title: '2 BHK in Baner', address: 'B-1204, Baner, Pune', locality: 'Baner',
    bhk: '2 BHK', rent, deposit: rent * 3, dueDay: 5, leaseStart: lease(start), leaseEnd: lease(end), status: 'active',
  };
  const payments = [monthsAgo(2), monthsAgo(1)].map((m, i) => ({
    id: 'rp' + i, type: 'rent', to: 'Rahul Deshmukh', tenant: TENANT.name, propId: 'PN-RENT-TEST',
    month: m, amount: rent, method: 'UPI', at: Date.now() - i * 1000,
  }));
  await page.addInitScript(({ u, t, p, wr }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    if (wr) {
      localStorage.setItem('pnTenancies:' + u.mobile, JSON.stringify([t]));
      localStorage.setItem('pnRentPayments:' + u.mobile, JSON.stringify(p));
      localStorage.setItem('pnTenantProfile:' + u.mobile, JSON.stringify({ idVerified: true, employment: 'Salaried' }));
    }
  }, { u: TENANT, t: tenancy, p: payments, wr: withRental });
}

test.describe('Dashboard — tenant Finances (Rent Wallet)', () => {
  test('a tenant sees the Rent Wallet with KPIs, Rent Passport and HRA saver', async ({ page }) => {
    const errors = trackErrors(page);
    await loginTenant(page);
    await page.goto(`${BASE}/dashboard#finances`, { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Rent Wallet' })).toBeVisible();
    await expect(page.getByText('Lifetime on PuneNest')).toBeVisible();
    await expect(page.getByText('Deposit locked')).toBeVisible();

    // Rent Passport — the differentiator — and its downloadable report.
    await expect(page.getByRole('heading', { name: 'Rent Passport' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Download report/ })).toBeVisible();
    await expect(page.getByText(/2 on-time payments/)).toBeVisible();

    expect(errors, 'console errors on Rent Wallet').toEqual([]);
  });

  test('HRA Tax Saver computes an estimated saving from an entered salary', async ({ page }) => {
    await loginTenant(page);
    await page.goto(`${BASE}/dashboard#finances`, { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'HRA Tax Saver' })).toBeVisible();
    await page.locator('input[type="number"]').first().fill('600000');
    await expect(page.getByText('Estimated tax you save')).toBeVisible();
    await expect(page.getByText('HRA exemption (Section 10(13A))')).toBeVisible();
  });

  test('a tenant with no rental gets the Rent Wallet empty state', async ({ page }) => {
    await loginTenant(page, { withRental: false });
    await page.goto(`${BASE}/dashboard#finances`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Rent Wallet is waiting/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Load a demo rental/ })).toBeVisible();
  });
});
