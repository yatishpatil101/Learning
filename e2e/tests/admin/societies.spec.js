import { test, expect } from '../../fixtures/base.js';

// Admin Societies desk — /admin/societies
// Guarded by RoleRoute roles=['admin','manager'] (redirect -> /staff-login) +
// ModuleRoute moduleKey="societies". Source: frontend/src/pages/admin/AdminSocieties.jsx
// (+ societies/*Tab.jsx, lib/store/society*.js).
//
// Tabs = Claims | Resident Verifications | Candidates | Directory | Moderation.
// Claims/residents/candidates/moderation queues are localStorage-backed and start
// empty in a fresh browser context. The Directory tab lists the full society
// catalogue; editing a society opens an overlay dialog that persists via
// setSocietyOverlay and fires a "Society details saved" toast (role="alert").

test('admin loads the Societies desk with KPIs, tabs and the empty claims queue', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/societies');

  await expect(page.getByRole('heading', { name: 'Societies' })).toBeVisible();

  // KPI tiles.
  await expect(page.getByText('Pending claims')).toBeVisible();
  await expect(page.getByText('Pending residents')).toBeVisible();
  await expect(page.getByText('Open reports')).toBeVisible();

  // Tab bar.
  await expect(page.getByRole('button', { name: 'Claims', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resident Verifications' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Directory', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Moderation', exact: true })).toBeVisible();

  // Default tab (claims) starts empty in a fresh context.
  await expect(page.getByRole('cell', { name: 'No claim requests yet.' })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('the Directory tab lists the society catalogue in a paginated table', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/societies');

  await page.getByRole('button', { name: 'Directory', exact: true }).click();

  await expect(page.getByText(/Showing 1–10 of \d+ directory/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' }).first()).toBeVisible();
});

test('editing a society through the overlay dialog saves with a toast', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/societies');

  await page.getByRole('button', { name: 'Directory', exact: true }).click();
  await page.getByRole('button', { name: 'Edit' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Edit society' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('alert')).toContainText('Society details saved');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the Moderation tab shows empty queues for a fresh workspace', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/societies');

  await page.getByRole('button', { name: 'Moderation', exact: true }).click();

  await expect(page.getByText('No open reports.', { exact: false })).toBeVisible();
  await expect(page.getByText('No links awaiting review.', { exact: false })).toBeVisible();
  await expect(page.getByText('No proposed pins.', { exact: false })).toBeVisible();
});

test('unauthenticated visitor is redirected to staff-login', async ({ page }) => {
  await page.goto('/admin/societies');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Societies' })).toHaveCount(0);
});

test('a buyer cannot open the admin societies desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/societies');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Societies' })).toHaveCount(0);
});
