import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

// The EMI calculator flag is enabled by default; these tests exercise the
// calculator's own interactive controls (sliders, inputs, lender cards,
// reset, and the year-wise amortization breakup).
test.describe('EMI calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/emi-calculator`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  });

  const emi = (page) => page.locator('.gradient-text').first().innerText();
  const rateInput = (page) => page.locator('input[type=number]').nth(1);

  test('renders controls and computes an EMI', async ({ page }) => {
    await expect(page.locator('input[type=range]')).toHaveCount(3);
    await expect(page.locator('input[type=number]')).toHaveCount(3);
    expect(await emi(page)).toMatch(/₹[\d,]+/);
  });

  test('amount slider updates the EMI', async ({ page }) => {
    const before = await emi(page);
    const slider = page.locator('input[type=range]').first();
    await slider.focus();
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    expect(await emi(page)).not.toBe(before);
  });

  test('lender card applies its rate and shows active state', async ({ page }) => {
    const hdfc = page.locator('button:has-text("HDFC")');
    await hdfc.click();
    await page.waitForTimeout(150);
    await expect(rateInput(page)).toHaveValue('8.6');
    await expect(hdfc).toHaveAttribute('aria-pressed', 'true');
  });

  test('reset restores defaults', async ({ page }) => {
    const amt = page.locator('input[type=number]').first();
    await amt.fill('12000000');
    await page.waitForTimeout(100);
    await page.locator('button:has-text("Reset")').click();
    await page.waitForTimeout(150);
    await expect(amt).toHaveValue('8000000');
    await expect(rateInput(page)).toHaveValue('8.5');
  });

  test('number input clamps out-of-range values on blur', async ({ page }) => {
    const amt = page.locator('input[type=number]').first();
    await amt.fill('999999999');
    await amt.blur();
    await page.waitForTimeout(100);
    await expect(amt).toHaveValue('50000000');
    await amt.fill('1');
    await amt.blur();
    await page.waitForTimeout(100);
    await expect(amt).toHaveValue('500000');
  });

  test('year-wise breakup expands and repays the balance to zero', async ({ page }) => {
    const toggle = page.locator('button:has-text("Year-wise breakup")');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.waitForTimeout(200);
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(20);
    const lastBalance = await rows.last().locator('td').last().innerText();
    expect(lastBalance).toBe('₹0');
  });
});
