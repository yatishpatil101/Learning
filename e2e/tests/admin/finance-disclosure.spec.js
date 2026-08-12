import { test, expect } from '@playwright/test';

/* D63 / D65 — the money figures that have no path behind them must say so.
 *
 * `/admin/finance` shows "Partner payouts", "Refunds (recent)" and a services revenue line. Two of
 * those describe mechanisms the platform does not have (nothing has ever been remitted; there is no
 * refund path) and the third is a quote rather than a receipt, so the services marketplace is
 * excluded from revenue entirely. Rendered plainly they are ordinary numbers, and an operator
 * reading them concludes something false about the business rather than something true about the
 * software.
 *
 * These specs pin both halves of the fix: that the disclosure is there by default, and that it is
 * genuinely driven by configuration rather than hard-coded — because a disclosure that cannot be
 * turned off is one that will be deleted the day payouts ship, taking the other two with it.
 *
 * The flags live at `settings.finance.*` in the mock document (mirroring `punenest.finance.*` on
 * the server), so the switch is exercised here by patching the seeded DB and reloading.
 */

const BASE = 'http://localhost:5173';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

/* The DB is seeded on first load, so this has to run after a navigation, not in an init script. */
async function setFinanceFlags(page, finance) {
  await page.evaluate((f) => {
    const raw = localStorage.getItem('puneNestDB_v5');
    if (!raw) throw new Error('mock DB not seeded — navigate before patching settings');
    const db = JSON.parse(raw);
    db.settings = { ...db.settings, finance: f };
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
  }, finance);
}

const DISCLOSURES = '[data-testid="finance-disclosures"]';

test.describe('admin finance — structural zeros disclose themselves', () => {
  test('the default screen warns that not every figure is measured', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/finance`);

    const panel = page.locator(DISCLOSURES);
    await expect(panel).toBeVisible({ timeout: 5000 });
    await expect(panel).toContainText(/not every figure/i);
  });

  /* Each of the three reasons is named, not summarised. "Some numbers are estimates" tells an
     operator nothing they can act on; "no payout has ever been executed" tells them exactly which
     figure to stop trusting and why. */
  test('all three reasons are named by default', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/finance`);

    const panel = page.locator(DISCLOSURES);
    await expect(panel).toContainText(/no payout has ever been executed/i);
    await expect(panel).toContainText(/no refund path/i);
    await expect(panel).toContainText(/excludes the services marketplace/i);
  });

  /* The disclosure travels with the figure. A banner alone is read once and then scrolled past;
     the marker beside the row is what is on screen at the moment the number is being read. */
  test('the payouts and refunds rows are marked in place, and keep their figures', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/finance`);

    const payouts = page.locator('.pn-card').filter({ hasText: 'Payouts & outstanding' }).last();
    await expect(payouts).toContainText(/Partner payouts \(65%\)/);
    await expect(payouts).toContainText(/Refunds \(recent\)/);
    await expect(payouts).toContainText(/Not measured/i);
    // The number is still rendered — omitting it would make an absent money path and a rendering
    // bug into the same blank cell.
    await expect(payouts).toContainText(/₹/);
  });

  test('turning every flag on removes the disclosure without a code change', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/finance`);
    await expect(page.locator(DISCLOSURES)).toBeVisible({ timeout: 5000 });

    await setFinanceFlags(page, {
      payoutsMeasured: true,
      refundsMeasured: true,
      serviceOrdersCounted: true,
    });
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible({ timeout: 5000 });
    await expect(page.locator(DISCLOSURES)).toHaveCount(0);
  });

  /* The flags are independent: shipping payouts must not silently stop the screen disclosing that
     refunds and service orders are still unbacked. */
  test('flipping one flag leaves the other two disclosures standing', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/finance`);
    await expect(page.locator(DISCLOSURES)).toBeVisible({ timeout: 5000 });

    await setFinanceFlags(page, { payoutsMeasured: true });
    await page.reload();

    const panel = page.locator(DISCLOSURES);
    await expect(panel).toBeVisible({ timeout: 5000 });
    await expect(panel).not.toContainText(/no payout has ever been executed/i);
    await expect(panel).toContainText(/no refund path/i);
    await expect(panel).toContainText(/excludes the services marketplace/i);
  });

  /* An explicit `false` and an absent key must behave identically. Anything else means the default
     depends on whether someone remembered to write the key down. */
  test('an absent flag is treated as not measured', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/finance`);
    await setFinanceFlags(page, {});
    await page.reload();

    await expect(page.locator(DISCLOSURES)).toBeVisible({ timeout: 5000 });
  });
});
