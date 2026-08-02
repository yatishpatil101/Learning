import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

// ─── Support → Services redirect ───

test('/admin/support redirects to /admin/services', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/support`);
  await page.waitForURL('**/admin/services');
  expect(page.url()).toContain('/admin/services');
});

test('Support nav item is removed from sidebar', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin`);
  // The sidebar should NOT have a "Support" link anymore
  const supportLink = page.locator('nav a[href="/admin/support"]');
  await expect(supportLink).toHaveCount(0);
});

// ─── Analytics Revenue tab removed ───

test('Analytics no longer shows Revenue tab', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await page.waitForTimeout(500);
  const revTab = page.locator('button:has-text("Revenue"), [role="tab"]:has-text("Revenue")');
  await expect(revTab).toHaveCount(0);
});

// ─── Analytics Conversion tab removed ───

test('Analytics no longer shows Conversion tab', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await page.waitForTimeout(500);
  // Should NOT have a Conversion button/tab
  const convTab = page.getByRole('button', { name: 'Conversion' });
  await expect(convTab).toHaveCount(0);
});

// ─── Staff Activity - Today's Progress removed ───

test('Staff Activity does not show Today\'s Progress section', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/staff-activity`);
  await page.waitForTimeout(500);
  await expect(page.getByText("Today's Progress")).toBeHidden();
});

test('Staff Activity shows Audit Log cross-link', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/staff-activity`);
  await expect(page.getByText('View Audit Log')).toBeVisible({ timeout: 5000 });
});

// ─── Content - Localities & City Demand tabs removed ───

test('Content page does not show Localities tab', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/content`);
  await page.waitForTimeout(500);
  const locTab = page.getByRole('button', { name: /Localities/i });
  await expect(locTab).toHaveCount(0);
});

test('Content page does not show City Demand tab', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/content`);
  await page.waitForTimeout(500);
  const demandTab = page.getByRole('button', { name: /City Demand/i });
  await expect(demandTab).toHaveCount(0);
});

test('Content page shows Banners tab as default', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/content`);
  await expect(page.getByText('Promotional banners')).toBeVisible({ timeout: 5000 });
});

test('Content page shows all four tabs', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/content`);
  await expect(page.getByRole('button', { name: 'Banners' })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'FAQs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Announcements' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reviews' })).toBeVisible();
});

test('Content Reviews tab shows reviews with correct author names', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/content`);
  await page.getByRole('button', { name: 'Reviews' }).click();
  await expect(page.getByText('Moderate user reviews')).toBeVisible({ timeout: 5000 });
  // Reviews should show actual user names from data (not 'User' fallback)
  await expect(page.getByRole('table').getByText('Gauri Rao')).toBeVisible();
  // Approve/Reject buttons should exist for pending reviews
  await expect(page.getByRole('button', { name: 'Approve' }).first()).toBeVisible();
});

// ─── Finance - Deal Pipeline card ───

test('Finance page shows Deal Pipeline card with link to Enquiries', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await expect(page.getByText('Deal Pipeline')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('link', { name: /View all deals/i })).toBeVisible();
});

// ─── Settings Audit Log cross-link ───

test('Settings Audit Log shows Staff Activity cross-link', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/settings`);
  // Navigate to audit log tab
  const auditBtn = page.getByRole('button', { name: /Audit/i });
  if (await auditBtn.isVisible()) {
    await auditBtn.click();
    await page.waitForTimeout(300);
    await expect(page.getByText('View Staff Activity')).toBeVisible({ timeout: 5000 });
  }
});

// ─── No page errors ───

test('admin dashboard loads without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin`);
  await page.waitForTimeout(1000);
  expect(errors).toHaveLength(0);
});

test('admin services page loads without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/services`);
  await page.waitForTimeout(1000);
  await expect(page.getByRole('heading', { name: 'Service Requests' })).toBeVisible({ timeout: 5000 });
  expect(errors).toHaveLength(0);
});

test('admin analytics page loads without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await page.waitForTimeout(1000);
  expect(errors).toHaveLength(0);
});

// ─── Enquiries module ───

test('admin enquiries page loads with KPIs and tabs', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/enquiries`);
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible({ timeout: 5000 });
  // KPI tiles
  await expect(page.getByText('Enquiries', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Open leads')).toBeVisible();
  await expect(page.getByText('Site visits')).toBeVisible();
  await expect(page.getByText('Deal GMV')).toBeVisible();
  // Tabs
  await expect(page.getByRole('button', { name: /Enquiries/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Visits/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Deals/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Funnel/ })).toBeVisible();
  expect(errors).toHaveLength(0);
});

test('enquiries Funnel tab shows conversion funnel', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/enquiries`);
  await page.getByRole('button', { name: /Funnel/ }).click();
  await expect(page.getByRole('heading', { name: 'Conversion Funnel' })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Platform-wide Conversion Rates')).toBeVisible();
  await expect(page.getByText('Breakdown by Locality')).toBeVisible();
});

test('enquiries Visits tab shows scheduled visits', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/enquiries`);
  await page.getByRole('button', { name: /Visits/ }).click();
  await expect(page.getByText('Visit date')).toBeVisible({ timeout: 5000 });
});

// ─── Flatmates module ───

test('admin flatmates page loads with KPIs and seeded data', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loginAsAdmin(page);
  // Ensure flatmates seed data exists in localStorage DB
  await page.goto(`${BASE}/admin/flatmates`);
  await page.evaluate(() => {
    const raw = localStorage.getItem('puneNestDB_v1');
    const db = raw ? JSON.parse(raw) : {};
    if (!db.flatmateSeekers || db.flatmateSeekers.length === 0) {
      db.flatmateSeekers = [
        { id: 'SK1', name: 'Riya', gender: 'female', budget: 16000, localities: ['Baner'], verified: true, seed: true },
        { id: 'SK2', name: 'Sneha', gender: 'female', budget: 18000, localities: ['Hinjawadi'], verified: true, seed: true },
      ];
      db.flatmateGroups = [
        { id: 'SG1', title: '2 girls need 1 more for Baner', locality: 'Baner', policy: 'women', rent: 34000, seatsTotal: 3, members: [{ name: 'Riya' }, { name: 'Sneha' }], seed: true },
      ];
      db.groupApplications = [
        { id: 'GA1', listingTitle: '2 BHK Flat in Baner', groupTitle: '2 girls for Baner', applicantName: 'Riya', members: 2, seatsTotal: 3, status: 'pending' },
      ];
      localStorage.setItem('puneNestDB_v1', JSON.stringify(db));
    }
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Flatmate' })).toBeVisible({ timeout: 5000 });
  // Tab buttons
  await expect(page.getByRole('button', { name: 'Seekers' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Groups' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Group Applications' })).toBeVisible();
  // Seeded data appears in seekers table
  await expect(page.getByRole('table').getByText('Riya').first()).toBeVisible();
  expect(errors).toHaveLength(0);
});

test('flatmates Groups tab shows groups with moderation buttons', async ({ page }) => {
  await loginAsAdmin(page);
  await page.evaluate(() => {
    const raw = localStorage.getItem('puneNestDB_v5');
    const db = raw ? JSON.parse(raw) : {};
    db.flatmateGroups = [{ id: 'SG1', title: 'TestGroup Baner 2BHK', locality: 'Baner', policy: 'women', rent: 34000, seatsTotal: 3, members: [{ name: 'Riya' }, { name: 'Sneha' }], seed: true }];
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
  });
  await page.goto(`${BASE}/admin/flatmates`);
  await page.getByRole('button', { name: 'Groups' }).click();
  await expect(page.getByRole('table').getByText('TestGroup Baner 2BHK')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Flag' }).first()).toBeVisible();
});

test('flatmates Applications tab shows applications', async ({ page }) => {
  await loginAsAdmin(page);
  await page.evaluate(() => {
    const raw = localStorage.getItem('puneNestDB_v1');
    const db = raw ? JSON.parse(raw) : {};
    if (!db.groupApplications || db.groupApplications.length === 0) {
      db.groupApplications = [{ id: 'GA1', listingTitle: '2 BHK Flat in Baner', groupTitle: '2 girls for Baner', applicantName: 'Riya', members: 2, seatsTotal: 3, status: 'pending' }];
      localStorage.setItem('puneNestDB_v1', JSON.stringify(db));
    }
  });
  await page.goto(`${BASE}/admin/flatmates`);
  await page.getByRole('button', { name: 'Group Applications' }).click();
  await expect(page.getByRole('table').getByText('2 BHK Flat in Baner')).toBeVisible({ timeout: 5000 });
});
