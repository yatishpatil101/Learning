import { test, expect } from '../../fixtures/base.js';

// Admin Service Requests desk — /admin/services
// Guarded by RoleRoute roles=['admin'] (redirect -> /staff-login) +
// ModuleRoute moduleKey="services". Source: frontend/src/pages/admin/AdminServices.jsx
// (+ lib/mockApi/tickets.js, lib/data/tickets.js).
//
// Seeded tickets (frontend/src/data/db.json): 34 total — 9 new, 9 in_progress,
// 10 done, 6 cancelled. The desk is a route/assign/moderate queue with a linear
// status workflow: new --Start--> in_progress --Resolve--> done, plus a modal that
// reassigns staff and sets status directly. Each mutation persists via updateTicket
// and fires a toast (role="alert").

test('admin loads the Service Requests desk with KPIs, filters and paginated table', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/services');

  await expect(page.getByRole('heading', { name: 'Service Requests' })).toBeVisible();

  // KPI tiles reflect the seeded ticket mix.
  await expect(page.getByText('New requests')).toBeVisible();
  await expect(page.getByText('In Progress requests')).toBeVisible();
  await expect(page.getByText('Resolved requests')).toBeVisible();
  await expect(page.getByText('Total requests')).toBeVisible();

  // Filter summary + paginated table (pageSize 10) render the full 34-row feed.
  await expect(page.getByText('34 of 34 requests')).toBeVisible();
  await expect(page.getByText(/Showing 1–10 of 34 requests/)).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('Start transitions a new request to in progress with a toast', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/services');

  // Narrow to "new" leads so every visible row exposes a Start control.
  await page.getByLabel('Filter by status').click();
  await page.getByRole('option', { name: 'New', exact: true }).click();

  const summary = page.getByText(/^\d+ of 34 requests$/);
  await expect(summary).toHaveText('9 of 34 requests');

  await page.getByRole('button', { name: 'Start' }).first().click();

  await expect(page.getByRole('alert')).toContainText('Marked in progress');
  // The started ticket flips to in_progress and drops out of the "new" filter.
  await expect(summary).toHaveText('8 of 34 requests');
});

test('Resolve transitions an in-progress request to done with a toast', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/services');

  await page.getByLabel('Filter by status').click();
  await page.getByRole('option', { name: 'In Progress', exact: true }).click();

  const summary = page.getByText(/^\d+ of 34 requests$/);
  await expect(summary).toHaveText('9 of 34 requests');

  await page.getByRole('button', { name: 'Resolve' }).first().click();

  await expect(page.getByRole('alert')).toContainText('Request resolved');
  // Resolved ticket leaves the in_progress bucket.
  await expect(summary).toHaveText('8 of 34 requests');
});

test('the request modal reassigns staff and moderates status', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/services');

  // Work a "new" ticket so the assignment starts from Unassigned.
  await page.getByLabel('Filter by status').click();
  await page.getByRole('option', { name: 'New', exact: true }).click();

  await page.getByRole('button', { name: 'Open' }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Assignment & status')).toBeVisible();

  // Assign to the first real staff member for this ticket's team (index 0 is Unassigned).
  await dialog.getByLabel('Assign to').click();
  await page.getByRole('option').nth(1).click();

  // Moderate the status directly from the modal.
  await dialog.getByLabel('Status', { exact: true }).click();
  await page.getByRole('option', { name: 'In Progress', exact: true }).click();

  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('alert')).toContainText('Request updated');
  // Saving closes the modal and the ticket leaves the "new" queue.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/^\d+ of 34 requests$/)).toHaveText('8 of 34 requests');
});

test('searching for a non-existent request shows the empty state', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/services');

  await page.getByPlaceholder('Search id, customer, detail…').fill('zzz-no-such-request');

  await expect(page.getByText('0 of 34 requests')).toBeVisible();
  // The mobile card copy is hidden on desktop; assert the visible table cell.
  await expect(page.getByRole('cell', { name: 'No requests match' })).toBeVisible();
});

test('unauthenticated visitor is redirected to staff-login', async ({ page }) => {
  await page.goto('/admin/services');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Service Requests' })).toHaveCount(0);
});

test('a buyer cannot open the admin services desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/services');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Service Requests' })).toHaveCount(0);
});
