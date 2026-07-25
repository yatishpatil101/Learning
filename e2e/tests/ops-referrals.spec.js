import { test, expect } from '../fixtures/base.js';

/* Ops → Referral Verification (fraud review queue). Behaviour verified from:
     - pages/ops/OpsReferrals.jsx (queue, tabs, approve/reject/clawback + toasts),
     - data/referrals.json (seeded queue) via lib/mockApi listReferrals/mutateDb,
     - App.jsx: /ops/referrals sits under RoleRoute roles=['staff','admin'] with
       NO TeamRoute, so any signed-in staffer (or admin) may review; a signed-out
       visitor is bounced to /staff-login.
   A referral can only be Approved once the referred tenant is Aadhaar-verified AND
   that Aadhaar is unique (canQualify); approve → status 'rewarded' (Qualified tab),
   reject → status 'rejected'. */

// The global cookie-consent banner is also a dialog; seed consent so it never
// overlays the queue or intercepts an action click (pattern from support-tickets).
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

// A referral toast confirmation is rendered as role="alert" (ToastContext).
const toast = (page, re) => page.getByRole('alert').filter({ hasText: re });

test('the referral verification queue loads for an authorized staffer', async ({ page, login, consoleErrors }) => {
  await login.asStaff('Rental'); // RoleRoute staff → any staffer can review referrals
  await seedConsent(page);
  await page.goto('/ops/referrals');

  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();
  await expect(page.getByText('Keep referrals genuine — verify before reward.')).toBeVisible();

  // Tab filters (default = Pending) with their seeded counts.
  await expect(page.getByRole('button', { name: /Pending \(\d+\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Flagged \(\d+\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Qualified \(\d+\)/ })).toBeVisible();

  // A seeded pending referral row is shown (referrer → referred).
  await expect(page.getByRole('row').filter({ hasText: 'Suresh Rao' })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('approving a qualified referral rewards it and moves it to the Qualified tab', async ({ page, login }) => {
  await login.asStaff('Rental');
  await seedConsent(page);
  await page.goto('/ops/referrals');
  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();

  // Suresh Rao (RF3004) is pending, Aadhaar-verified + unique → Approve is enabled.
  const row = page.getByRole('row').filter({ hasText: 'Suresh Rao' });
  await row.getByRole('button', { name: 'Approve' }).click();

  // Real behaviour: success toast + the row leaves the Pending queue.
  await expect(toast(page, /Approved — reward granted/)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Suresh Rao' })).toHaveCount(0);

  // Status transition: it now shows under the Qualified tab (qualified|rewarded).
  await page.getByRole('button', { name: /Qualified \(\d+\)/ }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Suresh Rao' })).toBeVisible();
});

test('rejecting a referral removes it from the pending queue with a toast', async ({ page, login }) => {
  await login.asStaff('Rental');
  await seedConsent(page);
  await page.goto('/ops/referrals');
  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();

  // Pooja Nair (RF3007) is a pending referral we reject.
  const row = page.getByRole('row').filter({ hasText: 'Pooja Nair' });
  await row.getByRole('button', { name: 'Reject' }).click();

  await expect(toast(page, /^Rejected$/)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Pooja Nair' })).toHaveCount(0);
});

test('the queue shows an empty state once every pending referral is handled', async ({ page, login }) => {
  await login.asStaff('Rental');
  await seedConsent(page);
  await page.goto('/ops/referrals');
  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();

  // Reject every pending row; each reject re-renders the queue one row shorter.
  const rejects = page.getByRole('button', { name: 'Reject', exact: true });
  for (let n = await rejects.count(); n > 0; n -= 1) {
    await rejects.first().click();
    await expect(rejects).toHaveCount(n - 1);
  }

  // OpsReferrals renders the empty-state cell when the active tab has no rows.
  await expect(page.getByText('No referrals here 🎁')).toBeVisible();
});

test('an unauthenticated visitor is redirected from /ops/referrals to staff-login', async ({ page }) => {
  await page.goto('/ops/referrals');

  // RoleRoute → Navigate to /staff-login (no referral queue rendered).
  await expect(page).toHaveURL(/\/staff-login/);
  await expect(page.getByRole('button', { name: 'Rental', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toHaveCount(0);
});
