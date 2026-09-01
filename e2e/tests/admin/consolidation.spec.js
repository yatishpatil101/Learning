import { test, expect } from '@playwright/test';
import { trackErrors } from '../../helpers/console.js';

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
  const errors = trackErrors(page);
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin`);
  await page.waitForTimeout(1000);
  expect(errors).toHaveLength(0);
});

test('admin services page loads without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/services`);
  await page.waitForTimeout(1000);
  await expect(page.getByRole('heading', { name: 'Service Requests' })).toBeVisible({ timeout: 5000 });
  expect(errors).toHaveLength(0);
});

/* The /admin/analytics load-without-errors sweep lives in analytics.spec.js.
   The copy that used to sit here was byte-identical, so it bought a second
   admin login and page load for nothing. */

// ─── Enquiries module ───

test('admin enquiries page loads with KPIs and tabs', async ({ page }) => {
  const errors = trackErrors(page);
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
//
// Three tests lived here that drove `/admin/flatmates`, which is retired (wave 2c part 3):
// it moderated seekers, groups and group applications out of `db.json`, could not see rooms,
// and had no view of the D72 publication axis. The route now redirects to `/ops/flatmate-review`,
// which does the same three jobs against the real API. The behaviour they asserted is covered by
// `ops/live-flatmate-moderation.spec.js`, and the redirect itself by `admin/flatmates.spec.js`.
