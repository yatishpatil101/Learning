import { test, expect, devices } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OWNER = { name: 'Owner Test', mobile: '9800000001', email: '', role: 'owner', joinedAt: Date.now() };
const LISTING = { id: 'L-TEST-1', title: 'Test 2 BHK, Baner', locality: 'Baner', deal: 'rent', price: 25000, status: 'approved', real: true, ownerMobile: '9800000001', views: 7 };

async function login(page, user, listings) {
  await page.addInitScript(({ u, l }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    if (l) localStorage.setItem('puneNestListings:' + u.mobile, JSON.stringify(l));
  }, { u: user, l: listings || null });
}

test('desktop: hovering a document info dot reveals its significance tip', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));

  await page.setViewportSize({ width: 1280, height: 1400 });
  await login(page, OWNER, [LISTING]);
  await page.goto(`${BASE}/dashboard#documents`, { waitUntil: 'networkidle' });
  await page.getByText('Document Vault').waitFor({ timeout: 15000 });

  // Title & Ownership is open by default; hover the first info dot.
  const dot = page.getByRole('button', { name: /What is Sale Deed/i }).first();
  await dot.scrollIntoViewIfNeeded();
  await dot.hover();
  const tip = page.locator('.pn-tip[role="tooltip"]');
  await expect(tip).toBeVisible({ timeout: 3000 });
  await expect(tip).toContainText(/ownership was transferred/i);
  // aria wiring while open
  await expect(page.locator('[data-tip][aria-describedby]').first()).toBeVisible();

  await page.mouse.move(2, 2);
  await expect(tip).toBeHidden({ timeout: 3000 });

  const relevant = errors.filter((e) => !/favicon|leaflet|googleapis|gstatic|maps|ERR_|net::|Failed to load resource|DevTools/i.test(e));
  expect(relevant, relevant.join('\n')).toHaveLength(0);
});

test('mobile/touch: tapping a document info dot opens then dismisses the tip', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], hasTouch: true });
  const page = await ctx.newPage();
  await login(page, OWNER, [LISTING]);
  await page.goto(`${BASE}/dashboard#documents`, { waitUntil: 'networkidle' });
  await page.getByText('Document Vault').waitFor({ timeout: 15000 });

  const dot = page.getByRole('button', { name: /What is Sale Deed/i }).first();
  await dot.scrollIntoViewIfNeeded();
  await dot.tap();
  const tip = page.locator('.pn-tip[role="tooltip"]');
  await expect(tip).toBeVisible({ timeout: 3000 });
  await expect(tip).toContainText(/Sale Deed/i);

  // Outside tap dismisses.
  await page.mouse.click(5, 5);
  await expect(tip).toBeHidden({ timeout: 3000 });
  await ctx.close();
});

test('owner Documents vault carries a property-scoped Rent Agreement panel', async ({ page }) => {
  // Rent agreements are property-specific, so they live in the owner "Property docs"
  // vault (scoped to the selected property), NOT the tenant "Personal" identity vault.
  await login(page, OWNER, [LISTING]);
  await page.goto(`${BASE}/dashboard#documents`, { waitUntil: 'networkidle' });
  await page.getByText('Document Vault').waitFor({ timeout: 15000 });

  // Owner context is the default for an owner. The Rent Agreement panel must be present
  // here and describe itself as per-property.
  const panel = page.getByRole('button', { name: /Rent Agreement/i }).first();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/for this property|Registered agreement for/i);
  await panel.click();
  await expect(page.getByText(/No rent agreement on record for this property|Riya/i)).toBeVisible();
});

test('a tenant sees their Rent Agreement in a property-scoped My Tenancy vault, not Personal', async ({ page }) => {
  const TENANT = { name: 'Yatish', mobile: '9800000002', email: '', role: 'buyer', joinedAt: Date.now() };
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    localStorage.setItem('pnTenancies:' + u.mobile, JSON.stringify([{
      id: 'ten-1', tenantMobile: u.mobile, propId: 'T-RENT-1', title: 'Rented 2 BHK, Baner',
      address: 'B-1204, Rohan Leher, Baner', ownerName: 'Rahul Deshmukh', rent: 28000, status: 'active',
    }]));
    localStorage.setItem('puneNestRentAgreement:' + u.mobile, JSON.stringify([{
      id: 'ra-1', propId: 'T-RENT-1', landlord: 'Rahul Deshmukh', tenant: 'Riya Tenant',
      status: 'registered', at: Date.now(),
    }]));
  }, TENANT);
  await page.goto(`${BASE}/dashboard#documents`, { waitUntil: 'networkidle' });
  await page.getByText('Document Vault').waitFor({ timeout: 15000 });

  // A non-owner tenant lands on "My Tenancy" by default; the agreement is scoped to their flat.
  await expect(page.getByRole('button', { name: /My Tenancy/i })).toBeVisible();
  const panel = page.getByRole('button', { name: /Rent Agreement/i }).first();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Registered agreement for Rented 2 BHK, Baner');
  await expect(page.getByText('Riya Tenant')).toBeVisible();

  // The old Personal-context "Rent Agreements" panel must be gone.
  await page.getByRole('button', { name: /^Personal$/ }).click();
  await expect(page.getByRole('button', { name: /Rent Agreements/i })).toHaveCount(0);
});
