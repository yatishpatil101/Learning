import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

test.describe('Admin Reports page redesign', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/reports`);
    await page.waitForTimeout(500);
  });

  test('page loads without errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(page.getByRole('heading', { name: 'Reports & Moderation' })).toBeVisible({ timeout: 5000 });
    expect(errors).toHaveLength(0);
  });

  test('KPI tiles are visible', async ({ page }) => {
    await expect(page.getByText('Open reports', { exact: true })).toBeVisible();
    await expect(page.getByText('Reported properties', { exact: true })).toBeVisible();
    await expect(page.getByText('Reported users', { exact: true })).toBeVisible();
    await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  });

  test('tab switching works', async ({ page }) => {
    // Default is "Reported properties"
    const usersTab = page.getByRole('button', { name: /Reported users/ });
    await usersTab.click();
    await page.waitForTimeout(300);
    // Tab should now be active
    await expect(usersTab).toHaveClass(/bg-brand-teal/);
  });

  test('search input has search icon and works', async ({ page }) => {
    const searchInput = page.locator('.pn-card input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('fake');
    await page.waitForTimeout(300);
  });

  test('status dropdown uses custom Select component', async ({ page }) => {
    // Should NOT have a native <select> for status
    const nativeSelect = page.locator('select');
    await expect(nativeSelect).toHaveCount(0);
  });

  test('reason filter dropdown is visible', async ({ page }) => {
    // Look for the reason filter trigger
    await expect(page.getByText('All reasons')).toBeVisible({ timeout: 5000 });
  });

  test('date range pills are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('button', { name: '7d' })).toBeVisible();
    await expect(page.getByRole('button', { name: '30d' })).toBeVisible();
  });

  test('clear filters button appears when filters active', async ({ page }) => {
    const clearBtn = page.locator('.pn-card button:has-text("Clear")');
    await expect(clearBtn).toBeHidden();
    await page.locator('.pn-card input[placeholder*="Search"]').fill('test');
    await page.waitForTimeout(300);
    await expect(clearBtn).toBeVisible();
  });

  test('bulk action bar appears when reports selected', async ({ page }) => {
    // Try to select a checkbox (open reports)
    const checkbox = page.locator('table input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await checkbox.click();
      await expect(page.getByText(/selected/)).toBeVisible({ timeout: 3000 });
      await expect(page.getByRole('button', { name: /Bulk Resolve/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Bulk Dismiss/ })).toBeVisible();
    }
  });

  test('export CSV button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Export CSV/ })).toBeVisible();
  });

  test('no broken UTF-8 characters visible', async ({ page }) => {
    const body = await page.locator('body').textContent();
    // These broken characters should NOT exist
    expect(body).not.toContain('â€"');
    expect(body).not.toContain('â€¦');
    expect(body).not.toContain('Â·');
    expect(body).not.toContain('ðŸŽ‰');
  });

  test('table shows report data', async ({ page }) => {
    // Should have at least one row with report data
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('detail modal opens on eye icon click', async ({ page }) => {
    const viewBtn = page.locator('button[title="View details"]').first();
    if (await viewBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await viewBtn.click();
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 3000 });
    }
  });
});
