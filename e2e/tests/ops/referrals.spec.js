import { test, expect } from '../../fixtures/base.js';

/**
 * Ops → referral fraud desk, **mock mode only**.
 *
 * Four of this file's five tests moved to `live-referrals.spec.js` in wave 2c, and could not stay.
 * They approved, rejected and counted referrals in `lib/mockApi.js`'s store, which disagrees with
 * the server about what a referral is: it has a `flagged` status `ReferralStatuses` does not know,
 * hands out unmasked phone numbers the server withholds, and its Approve grants a perk (a listing
 * slot, or +15 contacts) where the server pays rupees. A test asserting the mock's answers was
 * asserting that the desk still got it wrong.
 *
 * What is left is what genuinely needs no backend: the route guard, and the fact that the desk
 * refuses to work at all without the live API rather than showing a queue it cannot stand behind.
 */

test('an unauthenticated visitor is redirected from /ops/referrals to staff-login', async ({ page }) => {
  await page.goto('/ops/referrals');
  await expect(page).toHaveURL(/\/staff-login/);
});

test('the fraud desk says why it is shut rather than showing referrals it did not read', async ({ page, login }) => {
  await login.asStaff();
  await page.goto('/ops/referrals');

  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();
  await expect(page.getByText(/needs the live API/i)).toBeVisible();

  /* The specific reason matters more than the panel. These decisions release money, and the
     offline store would have the desk approving something with a different status vocabulary,
     different privacy rules and a different reward - so nothing that looks like a queue is shown. */
  await expect(page.getByText(/pays a perk where the server pays rupees/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
});
