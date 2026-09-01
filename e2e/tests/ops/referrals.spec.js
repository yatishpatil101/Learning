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
 * What is left is the one thing that genuinely needs no backend: the fact that the desk refuses to
 * work at all without the live API, rather than showing a queue it cannot stand behind. That is a
 * claim about mock mode itself, so mock mode is the only place it can be made.
 *
 * The route guard went to `live-referrals.spec.js` too. It used to assert here that an
 * unauthenticated visitor is bounced to staff-login, which is the weakest of the three refusals
 * that matter and the only one a browser with no server behind it can observe. The live version
 * adds the two that carry the weight: a signed-in **buyer** is bounced by the same router, and the
 * API refuses his token on `GET /referrals` outright.
 *
 * ## Verdict: HONOURED (1 test)
 *
 * The offline panel is never rendered live because the referral API is always available. Only mock
 * mode — where the desk gates on `isHttpDomain` — can observe the shut state and its reason.
 */

test('the fraud desk says why it is shut rather than showing referrals it did not read', async ({ page, login }) => {
  await login.asStaff();
  await page.goto('/ops/referrals');

  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();
  await expect(page.getByText(/needs the live API/i)).toBeVisible();

  /* The specific reason matters more than the panel. These decisions release money, and the
     offline store would have the desk approving something with a different status vocabulary,
     different privacy rules and a different reward - so nothing that looks like a queue is shown.

     This assertion used to read /pays a perk where the server pays rupees/, and pinned a reason
     that had stopped being true: D31b moved the *server* onto the browser's unit, so both pay
     owner contacts now. A shut work surface justifying itself with a disagreement that no longer
     exists is worse than an unexplained one - it invites someone to check, find it wrong, and
     conclude the whole panel is stale. What is asserted now is the half that survived: the mock
     grants by looking the referrer up on a phone number the wire no longer carries. */
  await expect(page.getByText(/looking the referrer up by that same number/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
});
