import { expect, test } from '../fixtures/live.js';
import { ACTORS } from '../fixtures/live.js';
import { signedInAs } from '../helpers/liveAuth.js';

test.describe('My Rental — live', () => {
  test('the tenant sees their real rented home, not a demo one, and no payment rail', async ({ page }) => {
    await signedInAs(page, ACTORS.tenant);
    await page.goto('/dashboard#rental', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('button', { name: 'Rental', exact: true }).first()).toBeVisible({ timeout: 60000 });

    // The card is the server's tenancy: the owner's name and the rent come from the database, and
    // neither is a string this browser could have invented.
    await expect(page.getByText('Meera Deshpande').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/38,000/).first()).toBeVisible();

    await test.step('no demo affordance survives anywhere on the panel', async () => {
      // Asserted by name rather than by absence of a seeder call, because the failure this guards
      // against is a button quietly reappearing in a later refactor.
      await expect(page.getByRole('button', { name: /Load a demo rental/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Remove demo rental/i })).toHaveCount(0);
    });

    await test.step('the panel offers no payment history and no HRA receipt, and says where the record lives', async () => {
      // There is no online rent rail, so the panel cannot show a payment history or offer a receipt.
      await expect(page.getByRole('button', { name: /HRA receipt/i })).toHaveCount(0);
      await expect(page.getByText(/Payment failed/)).toHaveCount(0);
      await expect(page.getByText(/Owner credited/)).toHaveCount(0);

      await expect(page.getByRole('heading', { name: 'Rent payments' })).toBeVisible();
      await expect(page.getByRole('link', { name: /Open my rent record/i })).toBeVisible();
    });

    await test.step('the Verified-Tenant meter shows a dash, not a zero, when there is no profile yet', async () => {
      // The score is the server's, and this fixture has no tenant profile, so there is no score to show.
      await expect(page.getByText('Verified-Tenant score')).toBeVisible();
      const row = page.getByText('Trust score').locator('..');
      await expect(row).toContainText('—');
      await expect(row).not.toContainText('0%');
    });
  });
  test('an owner who rents nothing has no My Rental tab', async ({ page }) => {
    await signedInAs(page, ACTORS.owner);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    // Meera owns the anchor listings, so the owner side of the dashboard is present…
    await expect(page.getByRole('button', { name: /^Requests$/ }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Rental', exact: true })).toHaveCount(0);
  });
});
