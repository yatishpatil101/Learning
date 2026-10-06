import { test, expect } from '../../../fixtures/live.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

test.describe('EMI calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/emi-calculator`, { waitUntil: 'networkidle' });
    // The route is lazy, so `networkidle` can land before the controls mount.
    await expect(page.locator('input[type=range]')).toHaveCount(3);
  });

  const emiOut = (page) => page.locator('.gradient-text').first();
  const rateInput = (page) => page.locator('input[type=number]').nth(1);

  test('renders controls, computes an EMI, and the amount slider updates it', async ({ page, consoleErrors }) => {
    await expect(page.locator('input[type=number]')).toHaveCount(3);
    await expect(emiOut(page)).toHaveText(/₹[\d,]+/);
    const before = await emiOut(page).innerText();

    const slider = page.locator('input[type=range]').first();
    await slider.focus();
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    await expect(emiOut(page)).not.toHaveText(before);
    expect(consoleErrors).toEqual([]);
  });

  test('number input clamps out-of-range values, a lender card applies its rate, and reset restores defaults', async ({ page }) => {
    const amt = page.locator('input[type=number]').first();

    await test.step('number input clamps out-of-range values on blur', async () => {
      await amt.fill('999999999');
      await amt.blur();
      await expect(amt).toHaveValue('50000000');
      await amt.fill('1');
      await amt.blur();
      await expect(amt).toHaveValue('500000');
    });

    await test.step('lender card applies its rate and shows active state', async () => {
      const hdfc = page.locator('button:has-text("HDFC")');
      await hdfc.click();
      await expect(rateInput(page)).toHaveValue('8.6');
      await expect(hdfc).toHaveAttribute('aria-pressed', 'true');
    });

    await test.step('reset restores defaults', async () => {
      await amt.fill('12000000');
      // Reset can only prove anything if the value it is resetting had actually landed first.
      await expect(amt).toHaveValue('12000000');
      await page.locator('button:has-text("Reset")').click();
      await expect(amt).toHaveValue('8000000');
      await expect(rateInput(page)).toHaveValue('8.5');
    });
  });

  test('year-wise breakup expands and repays the balance to zero', async ({ page }) => {
    const toggle = page.locator('button:has-text("Year-wise breakup")');
    await expect(toggle).toBeVisible();
    await toggle.click();
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(20);
    const lastBalance = await rows.last().locator('td').last().innerText();
    expect(lastBalance).toBe('₹0');
  });
});
