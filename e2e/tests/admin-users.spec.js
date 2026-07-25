import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

// ─── Page load & header ───

test('users page loads without JS errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(1000);
  expect(errors).toHaveLength(0);
});

test('users page shows title and account count', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible({ timeout: 5000 });
  // Subtitle shows account count
  await expect(page.getByText(/accounts/i)).toBeVisible({ timeout: 5000 });
});

test('users page shows Export CSV button', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await expect(page.getByRole('button', { name: /Export CSV/i })).toBeVisible({ timeout: 5000 });
});

// ─── Table rendering ───

test('users table renders with correct columns', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  for (const header of ['User', 'Role', 'City', 'Listings', 'Joined', 'Status']) {
    await expect(page.getByRole('columnheader', { name: header })).toBeVisible({ timeout: 5000 });
  }
});

test('users table shows rows', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  // At least one user row should be visible
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 5000 });
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
});

test('users table paginates — shows page controls when >10 users', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  // 60 users in seed — should have pagination
  await expect(page.getByLabel('Next page')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/Showing 1–10 of/)).toBeVisible();
});

// ─── Search & filters ───

test('search by name filters the table', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  // Get first user name from table
  const firstName = await page.locator('tbody tr:first-child td:nth-child(2)').textContent();
  const searchName = firstName?.split('\n')[0]?.trim().split(' ')[0] || 'Sid';
  await page.getByPlaceholder('Search name, mobile, ID…').fill(searchName);
  await page.waitForTimeout(300);
  // Subtitle should update to show filtered count
  await expect(page.getByText(/of \d+ accounts/i)).toBeVisible({ timeout: 3000 });
});

test('role filter: Owners filters to owner rows only', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  await page.getByLabel('Filter by role').click();
  await page.getByRole('option', { name: 'Owners' }).click();
  await page.waitForTimeout(300);
  // All visible role cells should say "owner"
  const roleCells = page.locator('tbody td:nth-child(3) span');
  const count = await roleCells.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < Math.min(count, 5); i++) {
    await expect(roleCells.nth(i)).toHaveText('owner');
  }
});

test('status filter: Suspended shows only suspended users', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  await page.getByLabel('Filter by status').click();
  await page.getByRole('option', { name: 'Suspended' }).click();
  await page.waitForTimeout(300);
  // Table should show suspended badge or empty state
  const rows = page.locator('tbody tr');
  const emptyMsg = page.getByText('No users match these filters.');
  const hasRows = (await rows.count()) > 0 && !(await emptyMsg.isVisible());
  if (hasRows) {
    const badges = page.locator('tbody').getByText('suspended', { exact: false });
    await expect(badges.first()).toBeVisible({ timeout: 3000 });
  } else {
    await expect(emptyMsg).toBeVisible({ timeout: 3000 });
  }
});

test('subtitle updates to filtered count when filters active', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  await page.getByLabel('Filter by role').click();
  await page.getByRole('option', { name: 'Staff' }).click();
  await page.waitForTimeout(300);
  await expect(page.getByText(/of \d+ accounts/i)).toBeVisible({ timeout: 3000 });
});

test('clearing filter restores full account count in subtitle', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  // Apply role filter
  await page.getByLabel('Filter by role').click();
  await page.getByRole('option', { name: 'Buyers' }).click();
  await page.waitForTimeout(300);
  // Clear filter
  await page.getByLabel('Filter by role').click();
  await page.getByRole('option', { name: 'All roles' }).click();
  await page.waitForTimeout(300);
  await expect(page.getByText(/accounts — owners/i)).toBeVisible({ timeout: 3000 });
});

// ─── Action buttons ───

test('verify button opens confirmation modal', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  const verifyBtn = page.locator('tbody tr button[title="Verify"]').first();
  if (await verifyBtn.count() > 0) {
    await verifyBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('heading', { name: 'Verify user' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 2000 });
  }
});

test('suspend button opens confirmation modal', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  const suspendBtn = page.locator('tbody tr button[title="Suspend"]').first();
  if (await suspendBtn.count() > 0) {
    await suspendBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('heading', { name: 'Suspend user' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 2000 });
  }
});

test('action modal has internal note field', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  // Open any action modal
  const anyActionBtn = page.locator('tbody tr button[title="Archive user"]').first();
  if (await anyActionBtn.count() > 0) {
    await anyActionBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
    // Internal note toggle should be present
    await expect(page.getByText('Internal note (optional)')).toBeVisible();
  }
});

test('action modal: confirm verify toggles verification badge', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  const verifyBtn = page.locator('tbody tr button[title="Verify"]').first();
  if (await verifyBtn.count() > 0) {
    await verifyBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForTimeout(400);
    // Toast should appear (not error toast)
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText(/verified/i)).toBeVisible({ timeout: 3000 });
  }
});

// ─── Timeline modal ───

test('eye icon opens activity timeline modal', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  const eyeBtn = page.locator('tbody tr button[title="View activity"]').first();
  if (await eyeBtn.count() > 0) {
    await eyeBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
    // Timeline modal shows user name in title
    await expect(page.getByText(/Activity —/)).toBeVisible({ timeout: 3000 });
    // Shows activity count
    await expect(page.getByText('activities')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 2000 });
  }
});

// ─── Bulk selection & operations ───

test('checkboxes appear in table rows', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  const checkboxes = page.locator('tbody input[type="checkbox"]');
  await expect(checkboxes.first()).toBeVisible({ timeout: 5000 });
});

test('selecting a row shows bulk action bar', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  await page.locator('tbody input[type="checkbox"]').first().click();
  await expect(page.getByText(/1 selected/)).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole('button', { name: /Verify all/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Suspend all/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Archive all/i })).toBeVisible();
});

test('bulk action shows modal confirmation (not browser confirm)', async ({ page }) => {
  // Intercept window.confirm — if bulk actions still used it, this would fire
  let confirmCalled = false;
  page.on('dialog', () => { confirmCalled = true; });

  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  await page.locator('tbody input[type="checkbox"]').first().click();
  await page.getByRole('button', { name: /Verify all/i }).click();

  // Should show a modal dialog, NOT a browser confirm
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
  expect(confirmCalled).toBe(false);

  // Cancel closes without acting
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 2000 });
});

test('bulk modal shows selected user count', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  // Select 2 users
  const boxes = page.locator('tbody input[type="checkbox"]');
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  await page.getByRole('button', { name: /Verify all/i }).click();
  await expect(page.getByText(/2 selected user/i)).toBeVisible({ timeout: 3000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('clear button deselects all rows', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  await page.locator('tbody input[type="checkbox"]').first().click();
  await expect(page.getByText(/1 selected/)).toBeVisible({ timeout: 2000 });
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText(/selected/)).not.toBeVisible({ timeout: 2000 });
});

test('select-all header checkbox selects all filtered rows', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  // Filter to Staff only (fewer rows, easier to count)
  await page.getByLabel('Filter by role').click();
  await page.getByRole('option', { name: 'Staff' }).click();
  await page.waitForTimeout(300);
  await page.locator('thead input[type="checkbox"]').click();
  // Bulk bar should appear showing all staff selected
  await expect(page.getByText(/selected/)).toBeVisible({ timeout: 3000 });
  const selectedText = await page.getByText(/selected/).textContent();
  const count = parseInt(selectedText?.match(/\d+/)?.[0] || '0');
  expect(count).toBeGreaterThan(0);
});

test('filter change clears selection', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(500);
  await page.locator('tbody input[type="checkbox"]').first().click();
  await expect(page.getByText(/1 selected/)).toBeVisible({ timeout: 2000 });
  // Change role filter
  await page.getByLabel('Filter by role').click();
  await page.getByRole('option', { name: 'Owners' }).click();
  await page.waitForTimeout(300);
  // Bulk bar should be gone
  await expect(page.getByText(/selected/)).not.toBeVisible({ timeout: 2000 });
});

// ─── No regressions ───

test('users page: no console errors on load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/users`);
  await page.waitForTimeout(1000);
  expect(errors).toHaveLength(0);
});
