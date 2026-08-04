import { test, expect } from '../../fixtures/base.js';

// Admin Enquiries & Deals Funnel — /admin/enquiries
// Guarded by RoleRoute roles=['admin','manager'] + ModuleRoute moduleKey="enquiries".
// Source: frontend/src/pages/admin/AdminEnquiries.jsx (+ enquiries/FunnelView.jsx).
// Seeded data: 60 enquiries (13 "new"), 23 visits, 16 deals.

test('admin loads the Enquiries & Deals desk with tabs, KPIs and table', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toBeVisible();

  // Tabs are buttons carrying a live count (Funnel has no count).
  await expect(page.getByRole('button', { name: /^Enquiries \(\d/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Visits \(\d/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Deals \(\d/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Funnel', exact: true })).toBeVisible();

  // KPI tiles.
  await expect(page.getByText('Open leads')).toBeVisible();
  await expect(page.getByText('Site visits')).toBeVisible();
  await expect(page.getByText('Deal GMV')).toBeVisible();

  // Paginated table renders the enquiries feed.
  await expect(page.getByText(/Showing 1–\d+ of \d+ records/)).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('Funnel tab renders the conversion funnel and syncs the URL', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  await page.getByRole('button', { name: 'Funnel', exact: true }).click();
  await expect(page).toHaveURL(/tab=funnel/);

  await expect(page.getByRole('heading', { name: 'Conversion Funnel' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Platform-wide Conversion Rates' })).toBeVisible();
  await expect(page.getByText('Total Enquiries')).toBeVisible();
  await expect(page.getByText('Revenue per Enquiry')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('deep-linking ?tab=deals opens the Deals tab with deal columns', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries?tab=deals');

  // Deal-specific column headers (Value / Closed) are unique to the deals table.
  await expect(page.getByRole('columnheader', { name: 'Value', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Closed', exact: true })).toBeVisible();
  await expect(page.getByText(/Showing 1–\d+ of \d+ records/)).toBeVisible();
});

test('status filter narrows the enquiries table', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  const shown = page.getByText(/\d+ shown/);
  await expect(shown).toHaveText('60 shown');

  // Open the custom status dropdown and pick "New".
  await page.getByLabel('Filter by status').click();
  await page.getByRole('option', { name: 'New', exact: true }).click();

  await expect(shown).toHaveText('13 shown');
  // No responded/closed rows leak through the "new" filter.
  await expect(page.getByText('responded', { exact: true })).toHaveCount(0);
});

test('marking an enquiry responded fires a confirmation toast', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  // Narrow to actionable "new" leads so a Responded control is present.
  await page.getByLabel('Filter by status').click();
  await page.getByRole('option', { name: 'New', exact: true }).click();

  await page.getByRole('button', { name: 'Responded' }).first().click();

  await expect(page.getByRole('alert')).toContainText('Marked as responded');
});

test('unauthenticated visitor is redirected to staff-login', async ({ page }) => {
  await page.goto('/admin/enquiries');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toHaveCount(0);
});

test('a buyer cannot open the admin enquiries desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/enquiries');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Enquiries & Deals' })).toHaveCount(0);
});
