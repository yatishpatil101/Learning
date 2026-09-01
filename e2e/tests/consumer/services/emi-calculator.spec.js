import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

// The EMI calculator flag is enabled by default; these tests exercise the
// calculator's own interactive controls (sliders, inputs, lender cards,
// reset, and the year-wise amortization breakup).
/* Not a `waitForTimeout`. The page is synchronous `useState` + `useMemo` with no debounce, fetch or
   timer anywhere in it, so every sleep this file used to carry was padding for a React re-render.
   Where a sleep sat directly above the assertion it was waiting for, it has simply gone: Playwright
   assertions retry, which is the whole point of them. Where it sat above a non-retrying read
   (`innerText()`, `.count()`) it has been replaced by the assertion that read implies. */
test.describe('EMI calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/emi-calculator`, { waitUntil: 'networkidle' });
    // The route is lazy, so `networkidle` can land before the controls mount.
    await expect(page.locator('input[type=range]')).toHaveCount(3);
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
    // `innerText()` inside a bare `expect` does not retry, so the retrying assertion is the wait.
    await expect(page.locator('.gradient-text').first()).not.toHaveText(before);
  });

  test('lender card applies its rate and shows active state', async ({ page }) => {
    const hdfc = page.locator('button:has-text("HDFC")');
    await hdfc.click();
    await expect(rateInput(page)).toHaveValue('8.6');
    await expect(hdfc).toHaveAttribute('aria-pressed', 'true');
  });

  test('reset restores defaults', async ({ page }) => {
    const amt = page.locator('input[type=number]').first();
    await amt.fill('12000000');
    // Reset can only prove anything if the value it is resetting had actually landed first.
    await expect(amt).toHaveValue('12000000');
    await page.locator('button:has-text("Reset")').click();
    await expect(amt).toHaveValue('8000000');
    await expect(rateInput(page)).toHaveValue('8.5');
  });

  test('number input clamps out-of-range values on blur', async ({ page }) => {
    const amt = page.locator('input[type=number]').first();
    await amt.fill('999999999');
    await amt.blur();
    await expect(amt).toHaveValue('50000000');
    await amt.fill('1');
    await amt.blur();
    await expect(amt).toHaveValue('500000');
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
