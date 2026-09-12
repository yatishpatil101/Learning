import { test, expect } from '../../fixtures/live.js';

test('settings page loads and feature flags work', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/settings');

  // Page renders
  await expect(page.getByText('Site details, the fee schedule')).toBeVisible({ timeout: 5000 });

  // Click Feature flags tab
  await page.getByRole('button', { name: 'Feature flags' }).click();

  // Application sub-tab renders with grouped panel
  await expect(page.getByText('Platform-wide feature toggles')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Discovery & Search').first()).toBeVisible({ timeout: 3000 });
  await expect(page.getByText('Communication').first()).toBeVisible({ timeout: 3000 });
  await expect(page.getByText('Platform & Access').first()).toBeVisible({ timeout: 3000 });

  // Click a different section
  await page.getByText('Monetization & Payments').first().click();
  await expect(page.getByText('Online rent payment')).toBeVisible({ timeout: 3000 });

  // Click Platform & Access
  await page.getByText('Platform & Access').first().click();
  await expect(page.getByText('Maintenance mode')).toBeVisible({ timeout: 3000 });
  await expect(page.getByText('Caution')).toBeVisible({ timeout: 3000 });

  // Switch to Admin Modules tab
  await page.getByRole('button', { name: 'Admin Modules' }).click();
  await page.waitForTimeout(1000);

  // No page errors
  expect(consoleErrors).toHaveLength(0);
});
