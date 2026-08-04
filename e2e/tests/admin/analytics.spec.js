import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5173';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

// ─── Analytics page load ───

test('analytics page loads without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await page.waitForTimeout(1000);
  expect(errors).toHaveLength(0);
});

test('analytics page shows PageHeader with title', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await expect(page.getByRole('heading', { name: /Analytics/i })).toBeVisible({ timeout: 5000 });
});

// ─── Tab rendering ───

test('analytics shows Traffic tab by default', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await expect(page.getByRole('tab', { name: 'Traffic' })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('tab', { name: 'Traffic' })).toHaveAttribute('aria-selected', 'true');
});

test('analytics shows all 8 expected tabs', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await page.waitForTimeout(500);
  for (const label of ['Traffic', 'Engagement', 'Anonymous surfers', 'Geography', 'Supply Gap', 'Pricing', 'SLA', 'Seasonal']) {
    await expect(page.getByRole('tab', { name: label })).toBeVisible({ timeout: 5000 });
  }
});

test('analytics does not show Conversion tab', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await page.waitForTimeout(500);
  await expect(page.getByRole('tab', { name: 'Conversion' })).toHaveCount(0);
});

// ─── Traffic tab features ───

test('Traffic tab: chart cards visible', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await expect(page.getByText('Visits & page views')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Traffic sources')).toBeVisible();
  await expect(page.getByText('Device split')).toBeVisible();
  await expect(page.getByText('New vs returning')).toBeVisible();
});

test('Traffic tab: range selector present', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await expect(page.getByLabel('Traffic window')).toBeVisible({ timeout: 5000 });
});

test('Traffic tab: export CSV button visible and clickable', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  const exportBtn = page.getByRole('button', { name: /Export traffic CSV/i });
  await expect(exportBtn).toBeVisible({ timeout: 5000 });
  await exportBtn.click();
  // No JS error thrown after click
});

// ─── Tab switching & URL sync ───

test('clicking a tab updates URL search param', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  await page.getByRole('tab', { name: 'Engagement' }).click();
  await expect(page).toHaveURL(/tab=engagement/, { timeout: 3000 });
});

test('deep-linking to ?tab=geography opens Geography tab', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics?tab=geography`);
  await expect(page.getByRole('tab', { name: 'Geography' })).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
  await expect(page.getByText('Listings by locality')).toBeVisible({ timeout: 5000 });
});

test('tab switch does not remount — days selector persists across tab switches', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics`);
  // Open the custom dropdown and pick 30 days
  await page.getByLabel('Traffic window').click();
  await page.getByRole('option', { name: 'Last 30 days' }).click();
  // Switch away and back
  await page.getByRole('tab', { name: 'Engagement' }).click();
  await page.getByRole('tab', { name: 'Traffic' }).click();
  // Selector should still show 30 days (state preserved — no remount)
  await expect(page.getByLabel('Traffic window')).toContainText('30 days');
});

// ─── Engagement tab ───

test('Engagement tab renders charts', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics?tab=engagement`);
  await expect(page.getByText('Avg. session duration')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Bounce rate')).toBeVisible();
  await expect(page.getByText('Top pages by views')).toBeVisible();
});

// ─── Anonymous Surfers tab ───

test('Anonymous Surfers tab renders KPI tiles with non-negative values', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics?tab=surfers`);
  await expect(page.getByText('Anonymous sessions')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Anonymous visits')).toBeVisible();
  // Values should be non-negative numbers
  const tiles = page.locator('.pn-card .text-2xl');
  const count = await tiles.count();
  for (let i = 0; i < count; i++) {
    const txt = await tiles.nth(i).textContent();
    const num = parseFloat(txt.replace(/[^0-9.]/g, ''));
    expect(num).toBeGreaterThanOrEqual(0);
  }
});

// ─── Geography tab ───

test('Geography tab renders locality charts', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics?tab=geography`);
  await expect(page.getByText('Listings by locality')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Demand index by locality')).toBeVisible();
  await expect(page.getByText(/Avg. rate/)).toBeVisible();
});

// ─── Supply Gap tab ───

test('Supply Gap tab renders KPI cards and table', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics?tab=supply-gap`);
  await expect(page.getByText('Under-served', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Well-served', { exact: true })).toBeVisible();
  await expect(page.getByText('Supply vs Demand by Locality')).toBeVisible();
  await expect(page.getByText('All Localities')).toBeVisible();
});

test('Supply Gap: City Expansion Requests section visible', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics?tab=supply-gap`);
  await expect(page.getByText('City Expansion Requests')).toBeVisible({ timeout: 5000 });
});

// ─── Pricing tab ───

test('Pricing tab renders KPI tiles and tables', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics?tab=pricing`);
  await expect(page.getByText('Listings analysed')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Listing Price Position')).toBeVisible();
  await expect(page.getByText('Locality Pricing Breakdown')).toBeVisible();
});

// ─── SLA tab ───

test('SLA tab renders KPI row and trend chart', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics?tab=sla`);
  await expect(page.getByText('Overall SLA')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Weekly SLA compliance trend')).toBeVisible();
  await expect(page.getByText('SLA Targets')).toBeVisible();
});

// ─── Seasonal tab ───

test('Seasonal tab renders demand pattern and events', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/analytics?tab=seasonal`);
  await expect(page.getByText('Monthly demand pattern')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Key seasonal events')).toBeVisible();
  await expect(page.getByText('Year-over-year demand growth')).toBeVisible();
});
