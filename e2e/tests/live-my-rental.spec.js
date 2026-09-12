// @ts-check
/**
 * My Rental (tenant hub) against the live API.
 *
 * Replaces `tests/consumer/account/my-rental.spec.js`, which drove the panel by clicking a
 * "Load a demo rental" button that wrote a tenancy straight into localStorage. That button is gone:
 * a tenancy is a record two people share, and a screen that could conjure one for itself was
 * testing the seeder, not the product. Everything below reads what the server actually holds.
 *
 * The fixture: Priya Nair (`9700000002`) rents the Wakad row house from Meera Deshpande
 * (`9470744469`) at INR 38,000/month on a 2026-06-01 -> 2027-05-31 lease.
 *
 * The tenancy carries no payments. It used to carry three — two settled and one failed — and
 * several assertions here turned on that failed row. V127 drops the online rent rail, so the
 * platform no longer witnesses a rent payment at all, and the panel's job on that half is now to
 * say so and point at the tenant's own self-declared record in the Finances tab.
 */
import { expect, test } from '../fixtures/live.js';
import { ACTORS } from '../fixtures/live.js';
import { signedInAs } from '../helpers/liveAuth.js';

test.describe('My Rental — live', () => {
  test('the tenant sees their real rented home, not a demo one', async ({ page }) => {
    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#rental', { waitUntil: 'networkidle' });

    // The tab exists for someone who actually rents.
    await expect(page.getByRole('button', { name: /My Rental/ }).first()).toBeVisible({ timeout: 15000 });

    // The card is the server's tenancy: the owner's name and the rent come from the database, and
    // neither is a string this browser could have invented.
    await expect(page.getByText('Meera Deshpande').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/38,000/).first()).toBeVisible();
  });

  test('no demo affordance survives anywhere on the panel', async ({ page }) => {
    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#rental', { waitUntil: 'networkidle' });
    await expect(page.getByText('Meera Deshpande').first()).toBeVisible({ timeout: 15000 });

    // Asserted by name rather than by absence of a seeder call, because the failure this guards
    // against is a button quietly reappearing in a later refactor.
    await expect(page.getByRole('button', { name: /Load a demo rental/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Remove demo rental/i })).toHaveCount(0);
  });

  test('the panel offers no payment history and no HRA receipt, and says where the record lives', async ({ page }) => {
    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#rental', { waitUntil: 'networkidle' });
    await expect(page.getByText('Meera Deshpande').first()).toBeVisible({ timeout: 15000 });

    /* This used to assert the opposite: three rent payments, one of them failed, and two HRA
       receipts. All of that came from the online rent rail, which no longer exists — V127 drops
       `rent_payments` — so the panel cannot show a payment history and must not offer a receipt.

       Asserted as an absence with a named replacement rather than as a bare absence, because the
       failure worth catching is not "the list is gone" but "a receipt button came back". An HRA
       receipt is a tax document; issued from this panel it would assert a payment the platform
       never witnessed, which is the single thing the rework exists to prevent. The tenant's own
       figures are self-declared and live in the Finances tab, which the card points at. */
    await expect(page.getByRole('button', { name: /HRA receipt/i })).toHaveCount(0);
    await expect(page.getByText(/Payment failed/)).toHaveCount(0);
    await expect(page.getByText(/Owner credited/)).toHaveCount(0);

    await expect(page.getByRole('heading', { name: 'Rent payments' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Open my rent record/i })).toBeVisible();
  });

  test('the Verified-Tenant meter shows a dash, not a zero, when there is no profile yet', async ({ page }) => {
    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#rental', { waitUntil: 'networkidle' });
    await expect(page.getByText('Meera Deshpande').first()).toBeVisible({ timeout: 15000 });

    /* The score is the server's, and this fixture has no tenant profile, so there is no score to
       show. `0%` would tell a tenant they scored nothing; the dash says the question is unanswered.
       Anchored on the "Trust score" row rather than on the card, because a `div` filtered by text
       matches every ancestor and `.last()` lands on the innermost one, which is the label itself. */
    await expect(page.getByText('Verified-Tenant score')).toBeVisible();
    const row = page.getByText('Trust score').locator('..');
    await expect(row).toContainText('—');
    await expect(row).not.toContainText('0%');
  });

  test('an owner who rents nothing has no My Rental tab', async ({ page }) => {
    await signedInAs(page, ACTORS.owner);
    await page.goto('/dashboard', { waitUntil: 'networkidle' });

    // Meera owns the anchor listings, so the owner side of the dashboard is present…
    await expect(page.getByRole('button', { name: /^Requests$/ }).first()).toBeVisible({ timeout: 15000 });
    // …and she is nobody's tenant, so the tab that would show her own rented home is not.
    await expect(page.getByRole('button', { name: /My Rental/ })).toHaveCount(0);
  });
});
