// @ts-check
/**
 * The tenant Rent Wallet against the live API.
 *
 * Replaces `tests/consumer/account/tenant-finances.spec.js`, which wrote a tenancy, two payments
 * and a tenant profile into localStorage before every assertion. The tab now reads
 * `GET /me/tenancies`, `GET /me/rent-payments`, `GET /me/tenant-profile` and
 * `GET /me/rent-agreements`, so there is nothing left for a spec to plant.
 *
 * ## Why the failed payment is the interesting fixture
 *
 * Priya (`9700000002`) has three rent payments on the seeded tenancy: two settled at INR 38,000 and
 * one that failed. The old local store only ever held successes, so three separate pieces of logic
 * were true by coincidence:
 *
 *  - `rentSummary` added every row's amount to "lifetime rent paid";
 *  - `rentPassport.onTime` counted every row as an on-time payment;
 *  - the downloadable Rent Passport PDF printed the literal string "On time" against every row.
 *
 * Against the server all three would have reported a failed charge as rent received — the last of
 * them inside a document the tenant hands to a prospective landlord. The assertions below pin the
 * corrected behaviour: the wallet totals INR 76,000, not INR 114,000.
 */
import { expect, test } from '../fixtures/live.js';
import { ACTORS } from '../fixtures/live.js';
import { signedInAs } from '../helpers/liveAuth.js';

test.describe('Rent Wallet — live', () => {
  test('the wallet totals only settled rent, not the failed charge', async ({ page }) => {
    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

    /* "Rent Wallet" is the label on the owner/tenant toggle, and Priya owns nothing, so she is
       early-returned straight into the wallet with no toggle to read. The KPI label is the honest
       anchor for "the wallet rendered". */
    await expect(page.getByText('Lifetime on PuneNest')).toBeVisible({ timeout: 15000 });

    /* Two settled payments of 38,000 => 76,000. The third row is a failed charge and must not be
       in this number. Asserted as an absolute figure rather than a relative one because the
       fixture is fixed and the whole point is which rows were counted. */
    await expect(page.getByText(/76,000/).first()).toBeVisible();
    await expect(page.getByText(/1,14,000/)).toHaveCount(0);
  });

  test('the Rent Passport counts two on-time payments, not three', async ({ page }) => {
    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Rent Passport' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Download report/ })).toBeVisible();
    // Both settled payments landed before their due date (paid 06-03 and 07-03 against a 5th).
    await expect(page.getByText(/2 on-time payments/)).toBeVisible();
  });

  test('the deposit panel reflects the real lease', async ({ page }) => {
    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

    await expect(page.getByText('Deposit locked')).toBeVisible({ timeout: 15000 });
  });

  test('the HRA saver computes a saving from an entered salary', async ({ page }) => {
    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'HRA Tax Saver' })).toBeVisible({ timeout: 15000 });
    await page.locator('input[type="number"]').first().fill('600000');
    await expect(page.getByText('Estimated tax you save')).toBeVisible();
    await expect(page.getByText('HRA exemption (Section 10(13A))')).toBeVisible();
  });

  test('the wallet offers no demo loader to a user with no rental', async ({ page }) => {
    // Meera owns property and rents nothing, so her Finances tab is the owner ledger rather than
    // the wallet. What matters here is that neither surface can seed itself a tenancy.
    await signedInAs(page, ACTORS.owner);
    await page.goto('/dashboard#finances', { waitUntil: 'networkidle' });

    await expect(page.getByRole('button', { name: /Load a demo rental/ })).toHaveCount(0);
  });
});
