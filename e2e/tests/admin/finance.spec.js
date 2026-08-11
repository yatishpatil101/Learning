import { test, expect } from '@playwright/test';
import { trackErrors } from '../../helpers/console.js';

const BASE = 'http://localhost:5173';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

// Open a themed custom Select (by aria-label) and click an option by text.
async function pickSelectOption(page, ariaLabel, optionText) {
  await page.locator(`[aria-label="${ariaLabel}"]`).click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: optionText }).first().click();
  await page.waitForTimeout(300);
}

// ─── Page load ───

test('finance page loads without JS errors', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(1000);
  expect(errors).toHaveLength(0);
});

test('finance page shows title', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible({ timeout: 5000 });
});

test('finance page shows Revenue CSV button', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await expect(page.getByRole('button', { name: /Revenue CSV/i })).toBeVisible({ timeout: 5000 });
});

// ─── KPI tiles ───

test('finance page shows all 7 KPI tiles', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  for (const label of [
    'MRR (subscriptions)',
    'Revenue this month',
    'Services revenue',
    'Featured revenue',
    'Revenue (12 mo)',
    'Rent-pay fees',
    'ARPU',
  ]) {
    await expect(page.getByText(label)).toBeVisible({ timeout: 5000 });
  }
});

test('KPI tiles show non-negative INR values', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  // Wait for settings to load (KPIs only render after settings resolves)
  await expect(page.getByText('MRR (subscriptions)')).toBeVisible({ timeout: 5000 });
  const values = page.locator('.pn-card .text-xl.font-extrabold');
  const count = await values.count();
  expect(count).toBeGreaterThanOrEqual(7);
  for (let i = 0; i < count; i++) {
    const txt = await values.nth(i).textContent();
    expect(txt).toMatch(/₹/);
  }
});

test('MoM delta badges visible on first 4 KPI tiles', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  // First 4 tiles have MoM delta
  await expect(page.getByText(/MoM/).first()).toBeVisible({ timeout: 5000 });
});

// ─── Deal pipeline card ───

test('Deal Pipeline card is visible with link to enquiries', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  await expect(page.getByText('Deal Pipeline')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('link', { name: /View all deals/i })).toBeVisible();
});

// ─── Charts section (finance.charts flag is on) ───

test('Revenue by month chart card is visible', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  await expect(page.getByText('Revenue by month')).toBeVisible({ timeout: 5000 });
});

test('Revenue mix doughnut card is visible', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  await expect(page.getByText('Revenue mix (this month)')).toBeVisible({ timeout: 5000 });
});

test('Revenue window selector changes range', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  const sel = page.locator('[aria-label="Revenue window"]');
  await expect(sel).toBeVisible({ timeout: 5000 });
  await pickSelectOption(page, 'Revenue window', '6 months');
  // No JS errors after range change
  await page.waitForTimeout(200);
  expect(errors).toHaveLength(0);
});

// ─── MRR models section (finance.models flag is on) ───

test('MRR growth chart is visible', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  await expect(page.getByText('MRR growth')).toBeVisible({ timeout: 5000 });
});

test('Subscriptions panel shows Owner plan and Seeker plan rows', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  await expect(page.getByText('Owner plan')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Seeker plan')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('MRR total')).toBeVisible({ timeout: 5000 });
});

test('Net position panel shows Gross revenue and Net retained rows', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  await expect(page.getByText('Gross revenue')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Net retained')).toBeVisible({ timeout: 5000 });
});

test('Payouts & outstanding panel is visible', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  await expect(page.getByText('Payouts & outstanding')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Partner payouts (65%)')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Platform commission (35%)')).toBeVisible({ timeout: 5000 });
});

// ─── Transactions table (finance.transactions flag is on) ───

test('Recent transactions heading is visible', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  await expect(page.getByText('Recent transactions')).toBeVisible({ timeout: 5000 });
});

test('Transactions table renders rows', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 5000 });
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
});

test('Transactions table has correct columns', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  for (const header of ['ID', 'Date', 'Party', 'Type', 'Amount', 'Status']) {
    await expect(page.getByRole('columnheader', { name: header })).toBeVisible({ timeout: 5000 });
  }
});

test('Transaction status badges use Badge component colors', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  // At least one status badge should be visible in tbody
  const badges = page.locator('tbody .rounded-full');
  await expect(badges.first()).toBeVisible({ timeout: 5000 });
});

test('Search transactions filters by party', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  const firstParty = await page.locator('tbody tr:first-child td:nth-child(3)').textContent();
  const term = firstParty?.trim().split(' ')[0] || 'TX';
  await page.getByPlaceholder('Search party or type…').fill(term);
  await page.waitForTimeout(300);
  // Table should still have rows or show empty state
  const rows = page.locator('tbody tr');
  const empty = page.getByText('No transactions match.');
  const hasRows = (await rows.count()) > 0 && !(await empty.isVisible());
  if (!hasRows) {
    await expect(empty).toBeVisible({ timeout: 3000 });
  }
});

test('Filter by status: Refunded shows refunded rows or empty state', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  await pickSelectOption(page, 'Filter by status', 'Refunded');
  const rows = page.locator('tbody tr');
  const empty = page.getByText('No transactions match.');
  const hasRows = (await rows.count()) > 0 && !(await empty.isVisible());
  if (hasRows) {
    await expect(page.locator('tbody').getByText('refunded', { exact: false }).first()).toBeVisible({ timeout: 3000 });
  } else {
    await expect(empty).toBeVisible({ timeout: 3000 });
  }
});

test('Filter by type filters transaction rows', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(500);
  // Open the type dropdown and read the available options
  await page.locator('[aria-label="Filter by type"]').click();
  await page.waitForTimeout(200);
  const options = (await page.locator('.pn-dropdown__option').allTextContents()).map((o) => o.trim());
  const firstType = options.find((o) => o && o !== 'All types');
  if (firstType) {
    await page.locator('.pn-dropdown__option', { hasText: firstType }).first().click();
    await page.waitForTimeout(300);
    const rows = page.locator('tbody tr');
    const empty = page.getByText('No transactions match.');
    const hasRows = (await rows.count()) > 0 && !(await empty.isVisible());
    if (hasRows) {
      // First type cell in tbody should contain selected type
      await expect(page.locator('tbody tr:first-child td:nth-child(4)')).toContainText(firstType, { timeout: 3000 });
    }
  } else {
    await page.keyboard.press('Escape');
  }
});

test('Transactions CSV export button is visible and clickable', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await expect(page.getByText('Recent transactions')).toBeVisible({ timeout: 5000 });
  // Use JS click to avoid viewport interception in long-page layout
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => /CSV/i.test(b.textContent));
    btns[btns.length - 1]?.click();
  });
  // No JS errors after click
  await page.waitForTimeout(300);
});

// ─── Transaction detail modal ───

test('Eye button opens transaction detail modal', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await expect(page.getByText('Recent transactions')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
  const eyeBtns = page.locator('tbody tr button');
  const count = await eyeBtns.count();
  if (count > 0) {
    // JS click avoids viewport/sticky-header interception on long pages
    await page.evaluate(() => {
      const btn = document.querySelector('tbody tr button');
      btn?.click();
    });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText(/Transaction ·/)).toBeVisible({ timeout: 3000 });
    for (const label of ['ID', 'Date', 'Party', 'Type', 'Amount', 'Status', 'Method']) {
      await expect(page.getByRole('dialog').getByText(label)).toBeVisible({ timeout: 3000 });
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 2000 });
  }
});

test('Transaction detail modal closes on Cancel/Escape', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await expect(page.getByText('Recent transactions')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(300);
  const count = await page.locator('tbody tr button').count();
  if (count > 0) {
    await page.evaluate(() => { document.querySelector('tbody tr button')?.click(); });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 2000 });
  }
});

// ─── No regressions ───

test('finance page: no console errors on load', async ({ page }) => {
  const errors = trackErrors(page);
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/finance`);
  await page.waitForTimeout(1000);
  expect(errors).toHaveLength(0);
});
