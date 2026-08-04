import { test, expect } from '../../fixtures/base.js';

// Admin Settings desk — /admin/settings
// Guarded by RoleRoute roles=['admin','manager'] (redirect -> /staff-login) +
// ModuleRoute moduleKey="settings". Source: frontend/src/pages/admin/AdminSettings.jsx
// (+ settings/AppFlagsPanel.jsx, lib/mockApi/*).
//
// Tabs = General | Fees | Maps | Feature flags | Audit log. Saving site details or
// the fee schedule persists via updateSettings and fires a success toast
// (role="alert"). Feature-flag toggles are gated behind a confirmation dialog — the
// toggle only lands (and the toast only fires) after Confirm; Cancel is a no-op, so
// this spec cancels the dialog to keep global flags untouched. The audit log is a
// list that starts empty in a fresh browser context.

test('admin loads the Settings desk with all tabs and the general form', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/settings');

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await expect(page.getByRole('button', { name: 'General', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fees', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Maps', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Feature flags', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Audit log', exact: true })).toBeVisible();

  // Default tab (general) shows the site-details form + save action.
  await expect(page.getByRole('button', { name: 'Save details' })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('saving site details fires a confirmation toast', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/settings');

  await page.getByRole('button', { name: 'Save details' }).click();

  await expect(page.getByRole('alert')).toContainText('Site details saved');
});

test('saving the fee schedule fires a confirmation toast', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/settings');

  await page.getByRole('button', { name: 'Fees', exact: true }).click();
  await page.getByRole('button', { name: 'Save fees' }).click();

  await expect(page.getByRole('alert')).toContainText('Fee schedule saved');
});

test('a feature-flag toggle is gated by a confirmation dialog that can be cancelled', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/settings');

  await page.getByRole('button', { name: 'Feature flags', exact: true }).click();

  // Discovery is the default application sub-section; capture the flag's state.
  const toggle = page.getByRole('switch', { name: 'Toggle Map search' });
  const before = await toggle.getAttribute('aria-checked');

  await toggle.click();

  // Confirmation gate appears before any change is committed.
  const confirmHeading = page.getByRole('heading', { name: /(Enable|Disable) Map Search\?/ });
  await expect(confirmHeading).toBeVisible();

  // Cancel keeps the global flag untouched and fires no toast.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirmHeading).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-checked', before);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the Audit log tab shows the empty state for a fresh workspace', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/settings');

  await page.getByRole('button', { name: 'Audit log', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  /* Table.jsx renders the empty state twice — once in the table and once in the
     `sm:hidden` stacked-card column that the audit log now supplies for phones —
     so scope the desktop assertion to the table. */
  await expect(page.getByRole('table').getByText('No changes logged yet.')).toBeVisible();
});

test('unauthenticated visitor is redirected to staff-login', async ({ page }) => {
  await page.goto('/admin/settings');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
});

test('a buyer cannot open the admin settings desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/settings');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
});
