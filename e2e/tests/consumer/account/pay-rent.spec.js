import { test, expect } from '../../../fixtures/base.js';
import { USERS } from '../../../helpers/seed.js';
import { appReady } from '../../../helpers/app.js';

/* /pay-rent — the payment path itself.
 *
 * `my-rental` asserts the link into this route and `feature-flags` asserts the
 * coming-soon/live switch, but nothing exercised what the page is for: the fee
 * breakdown, the payment, and the receipt. The
 * convenience fee is real money — a regression there is a billing bug, not a UI
 * bug, so it gets an arithmetic assertion rather than "a number is visible".
 *
 * Two seeding rules this route made obvious:
 *
 *  - Per-user keys (`pnTenancies:<mobile>`) can be written before boot; they are
 *    read fresh by lib/store/rent.js.
 *  - `puneNestDB_v5` cannot. mockApi migrates and merges it at module load, so a
 *    partial object written in an init script leaves the app without settings and
 *    the page renders nothing at all. Load once, mutate the real DB, then reload —
 *    the same order feature-flags.spec.js uses.
 */

const TENANT = USERS.tenant;
const RENT = 25000;

const tenancyRows = (n) => Array.from({ length: n }, (_, i) => ({
  id: `tn-e2e-${i}`,
  propId: `P-e2e-${i}`,
  title: `${2 + i} BHK in Test Society`,
  address: 'Baner, Pune',
  ownerName: 'Test Owner',
  ownerMobile: '9876500002',
  rent: RENT + i * 5000,
  status: 'active',
  at: Date.now(),
}));

/** Sign in as a tenant with `tenancies` finalised rentals and the flag on. */
async function openPayRent(page, { tenancies = 1 } = {}) {
  await page.addInitScript(({ user, rows }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(user));
    localStorage.setItem('puneNestUsers', JSON.stringify([user]));
    localStorage.setItem(`pnTenancies:${user.mobile}`, JSON.stringify(rows));
  }, { user: TENANT, rows: tenancyRows(tenancies) });

  await page.goto('/');
  // The seed lands one microtask past the point `goto` resolves (D129), so without this the
  // parse below hits `null` and the whole file fails on a TypeError instead of the flag.
  await appReady(page);
  await page.evaluate(() => {
    const raw = localStorage.getItem('puneNestDB_v5');
    if (!raw) throw new Error('mock store missing after appReady()');
    const db = JSON.parse(raw);
    db.settings.flags.onlineRentPayment = true;
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
  });
  await page.goto('/pay-rent');
  await expect(page.getByRole('heading', { name: 'Pay rent', exact: true })).toBeVisible({ timeout: 20_000 });
}

const tab = (page, name) => page.getByRole('button', { name, exact: true });

test.describe('Pay rent', () => {
  test('a tenant with no tenancy gets an honest empty state, not a broken form', async ({ page, consoleErrors }) => {
    await openPayRent(page, { tenancies: 0 });

    await expect(page.getByText('No active rental')).toBeVisible();
    // The empty state routes back into the funnel rather than dead-ending.
    await expect(page.getByRole('link', { name: 'Browse rentals' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('the fee breakdown is arithmetically correct and totals what the CTA charges', async ({ page }) => {
    await openPayRent(page);

    await page.getByPlaceholder('25000').fill('30000');

    // 2% convenience fee + 18% GST on the fee = ₹600 + ₹108 → ₹30,708 charged.
    await expect(page.getByText('₹600', { exact: true })).toBeVisible();
    await expect(page.getByText('₹108', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay ₹30,708' })).toBeVisible();
  });

  test('paying opens the payment as due — the owner is not credited until it clears', async ({ page }) => {
    await openPayRent(page);

    await page.getByPlaceholder('25000').fill(String(RENT));
    await page.getByRole('button', { name: /^Pay ₹/ }).click();

    /* This test used to assert "Owner credited" the instant Pay was tapped, because the mock wrote
       `status: 'paid'` — a localStorage write cannot fail.

       The server does not work that way and never could: `POST /me/rent-payments` computes the fee,
       opens a payment-gateway order and stores the row **`due`**. Only the signature-verified
       webhook moves it to `paid`, and nothing the browser does can make that happen.

       So the honest assertion is the opposite of the old one — the payment is recorded, and the
       owner is *not* yet described as credited. Telling a tenant their rent has landed before the
       money has is the single defect this slice exists to remove. */
    await expect(tab(page, 'History')).toHaveClass(/active/);
    await expect(page.getByText('₹25,590', { exact: true })).toBeVisible();
    await expect(page.getByText('Owner credited')).toHaveCount(0);

    // A receipt is offered for the HRA claim — the reason a tenant pays here at all.
    await expect(page.getByRole('button', { name: 'HRA receipt' })).toBeVisible();

    // It survives a reload (persisted, not just component state).
    await page.reload();
    await tab(page, 'History').click();
    await expect(page.getByText('₹25,590', { exact: true })).toBeVisible();
  });

  test('a tenant with several rentals can choose which one to pay for', async ({ page }) => {
    await openPayRent(page, { tenancies: 2 });

    /* `NativeSelect` is a themed `.pn-dropdown`, not a real <select> — open the
       trigger and pick from the portaled menu. */
    await page.locator('.pn-dropdown__trigger').first().click();
    await page.locator('.pn-dropdown__menu--portal [role="option"]').nth(1).click();

    // Switching rental repoints the amount at that tenancy's agreed rent.
    await expect(page.getByPlaceholder('25000')).toHaveValue(String(RENT + 5000));
  });

  test('a landlord payout account can be linked and removed', async ({ page }) => {
    await openPayRent(page);

    // Name is mandatory — submitting without it must be refused, not saved blank.
    await page.getByRole('button', { name: 'Verify & link' }).click();
    await expect(page.getByText("Enter the account holder's name.")).toBeVisible();

    await page.getByPlaceholder('As per bank records').fill('Test Owner');
    await page.getByPlaceholder('name@okhdfcbank').fill('testowner@okhdfcbank');
    await page.getByRole('button', { name: 'Verify & link' }).click();

    await expect(page.getByText('testowner@okhdfcbank')).toBeVisible();
    await expect(page.getByText('Verified', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Remove account' }).click();
    await expect(page.getByPlaceholder('name@okhdfcbank')).toBeVisible();
  });
});
