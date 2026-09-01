import { test, expect } from '../../fixtures/base.js';

// Admin Enquiries & Deals Funnel — /admin/enquiries
// Guarded by RoleRoute roles=['admin'] + ModuleRoute moduleKey="enquiries".
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

// D25 — the board masks contact numbers under both providers. The mock provider does its own
// masking rather than serving the store's raw numbers, so this pair of tests exercises the same
// screen behaviour the live desk has, and a regression that unmasked the list would fail here
// rather than only in the (much rarer) live run.
test('the enquiries board shows masked mobile numbers', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  // At least one masked number is on screen, and no ten-digit number is.
  await expect(page.getByText(/^\d{2}X{5}\d{3}$/).first()).toBeVisible();
  await expect(page.getByText(/^[6-9]\d{9}$/)).toHaveCount(0);
});

test('revealing a contact replaces the mask on that row only', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/enquiries');

  const masked = page.getByText(/^\d{2}X{5}\d{3}$/);
  await expect(masked.first()).toBeVisible();
  const maskedBefore = await masked.count();
  expect(maskedBefore).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Reveal contact' }).first().click();

  await expect(page.getByRole('alert')).toContainText('recorded');
  await expect(page.getByText(/^[6-9]\d{9}$/)).toHaveCount(1);
  await expect(page.getByText(/^\d{2}X{5}\d{3}$/)).toHaveCount(maskedBefore - 1);
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
