import { test, expect } from '../../../fixtures/base.js';

// Home Loans service landing (/home-loans) — a PUBLIC page built on ServiceLanding.
// Behaviour verified from pages/consumer/services/HomeLoans.jsx, LoanEmiCalc.jsx
// (computeEmi math), the shared ServiceLanding.jsx (sign-in gate on quote submit) and
// i18n/locales/en/services.json (homeLoans.* copy).

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('Home Loans landing', () => {
  test('renders the hero, EMI calculator and lender comparison', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/home-loans');

    await expect(page.locator('h1')).toContainText('Home loans made');
    await expect(page.locator('h1')).toContainText('simple & affordable');
    await expect(page.getByRole('heading', { name: 'Check Your Eligibility' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Plan your EMI before you apply' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compare Home Loan Rates' })).toBeVisible();
  });

  test('EMI updates when the loan-amount slider moves', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/home-loans');

    const emiCalc = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Plan your EMI before you apply' }) });
    const emi = emiCalc.locator('.gradient-text');
    await expect(emi).toContainText(/₹[\d,]+/);
    const before = await emi.innerText();

    // First slider is the loan amount (min 5L, max 3Cr, step 1L).
    const amount = emiCalc.locator('input[type=range]').first();
    await amount.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    // `innerText()` does not retry, so the sleep was load-bearing. The recomputed figure is the
    // thing it was waiting for, and `toHaveText` waits for exactly that.
    await expect(emi).not.toHaveText(before);
  });

  test('requesting loan offers while signed out routes to sign-in (service gate)', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/home-loans');

    await page.getByRole('button', { name: 'Get Loan Offers' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
  });

  test('loads with no real console errors', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await page.goto('/home-loans');
    await expect(page.locator('h1')).toContainText('Home loans made');
    expect(consoleErrors).toEqual([]);
  });
});
