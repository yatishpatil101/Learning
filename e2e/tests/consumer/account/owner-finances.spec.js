// @ts-check
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OWNER = { name: 'Owner Test', mobile: '9811100011', email: '', role: 'owner', joinedAt: Date.now() };
const PROP_ID = 'PN-OWN-REAL';

function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));
  return () => errors.filter((e) => !/favicon|leaflet|googleapis|gstatic|maps|ERR_|net::|Failed to load resource|Download the React DevTools/i.test(e));
}

/* isOwner is derived from hasListings(), not the user's role field — seed one posted
   listing so the dashboard routes to the owner P&L (OwnerFinances), not the tenant
   Rent Wallet. */
async function loginOwner(page) {
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    localStorage.setItem('puneNestListings:' + u.mobile, JSON.stringify([
      { id: 'PN-OWN-1', title: 'Test Flat, Baner', ownerMobile: u.mobile, real: true, status: 'approved' },
    ]));
  }, OWNER);
}

test.describe('Dashboard — owner Finances (property P&L)', () => {
  test('renders KPI tiles and the Set-up-ROI CTA in place of a blank tile', async ({ page }) => {
    const getErrors = trackErrors(page);
    await loginOwner(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/dashboard#finances`, { waitUntil: 'networkidle' });

    // On mobile the KPI carousel is the visible copy (the desktop grid is lg-only).
    await expect(page.getByText('Rent collected').first()).toBeVisible();
    await expect(page.getByText('Net cashflow').first()).toBeVisible();
    // Missing ownership basis => the ROI CTA replaces the old dead "—" tile.
    await expect(page.getByRole('button', { name: /Set up ROI/ }).first()).toBeVisible();
    // Detail is grouped under tabs; Activity is the default.
    await expect(page.getByRole('tab', { name: 'Activity' })).toBeVisible();
    // At-a-glance health chip is always visible in the header.
    await expect(page.getByText('Healthy')).toBeVisible();

    expect(getErrors(), 'console errors on owner Finances').toEqual([]);
  });

  test('opens the Add-transaction modal from the Activity tab', async ({ page }) => {
    await loginOwner(page);
    await page.goto(`${BASE}/dashboard#finances`, { waitUntil: 'networkidle' });

    await page.getByRole('tab', { name: 'Activity' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add transaction' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Recurring (monthly)')).toBeVisible();
  });

  test('promotes overdue dues into an Action-required strip with real labels', async ({ page }) => {
    await loginOwner(page);
    // Seed the mock DB (after hydrate) with an owned listing + a recurring OVERDUE
    // transaction so getDues() produces a due and the promoted strip renders.
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await page.evaluate(({ mob, propId }) => {
      const KEY = 'puneNestDB_v5';
      const db = JSON.parse(localStorage.getItem(KEY) || '{"listings":[]}');
      db.listings = db.listings || [];
      db.listings.unshift({
        id: propId, title: 'Owned 2 BHK, Baner', ownerMobile: mob, real: true, status: 'approved',
        deal: 'rent', locality: 'Baner', bhk: '2 BHK', price: 28000, createdAt: Date.now(),
      });
      localStorage.setItem(KEY, JSON.stringify(db));
      const now = new Date();
      const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const iso = last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0') + '-01';
      localStorage.setItem('puneNestFin:' + mob + ':' + propId, JSON.stringify([
        { id: 't1', type: 'income', category: 'Rent received', amount: 25000, date: iso, repeat: 'monthly', note: 'Flat 2B', createdAt: Date.now() },
      ]));
    }, { mob: OWNER.mobile, propId: PROP_ID });

    await page.goto(`${BASE}/dashboard#finances`, { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Action required' })).toBeVisible();
    // Old bug rendered "undefined — ... due undefined"; assert real fields instead.
    await expect(page.getByText('Rent received — Flat 2B').first()).toBeVisible();
    await expect(page.getByText(/days? overdue/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('undefined');
  });
});
