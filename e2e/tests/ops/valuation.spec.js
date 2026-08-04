import { test, expect } from '../../fixtures/base.js';

/* Ops Property Valuation desk — OpsServiceQueue type="valuation" (App.jsx
   /ops/valuation behind TeamRoute team="valuation"). Behaviour verified against
   OpsServiceQueue.jsx (SVC_CONFIG.valuation) + serviceFlow.js seedService('valuation'),
   which seeds two demo requests:
     - Deepak Shah  → advanced to "docs_review"
     - Kavita Menon → left at "submitted" (docs still to verify)
   Mirrors the passing ops-requests.spec.js patterns (quick staff login, guards). */

// The global cookie-consent banner is also a dialog; seed consent so it never
// overlays the queue or collides with the request-detail dialog lookup.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test('Valuation staff land on their desk with the queue tiles and search', async ({ page, login, consoleErrors }) => {
  await login.asStaff('Valuation');          // quick login → /ops/valuation
  await expect(page).toHaveURL(/\/ops\/valuation/);

  // OpsServiceQueue type="valuation" → SVC_CONFIG.valuation.title/subtitle.
  await expect(page.getByRole('heading', { name: 'Property Valuation' })).toBeVisible();
  await expect(page.getByText('Site visit, valuation report & delivery')).toBeVisible();
  // Status-tile filters + the queue search box.
  await expect(page.getByRole('button', { name: /Needs action/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Completed/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Search customer/i)).toBeVisible();
  /* Seeded demo rows are present. Scoped to the table because OpsServiceQueue now
     also renders an `sm:hidden` stacked card per row — both copies sit in the DOM
     at every width. */
  const table = page.getByRole('table');
  await expect(table.getByText('Deepak Shah')).toBeVisible();
  await expect(table.getByText('Kavita Menon')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('verifying documents advances a submitted request to "under review" with a toast', async ({ page, login }) => {
  await seedConsent(page);
  await login.asStaff('Valuation');
  await page.goto('/ops/valuation');

  // Open Kavita Menon's request (seeded at "submitted"). Row action opens the detail modal.
  const row = page.getByRole('row').filter({ hasText: 'Kavita Menon' });
  await row.getByRole('button', { name: 'Open' }).click();

  const dialog = page.getByRole('dialog', { name: /Property Valuation · Kavita Menon/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Request submitted').first()).toBeVisible();

  // "Mark all verified" runs markDocsVerified → status submitted → docs_review + toast.
  await dialog.getByRole('button', { name: /Mark all verified/i }).click();
  await expect(page.getByText('Documents verified', { exact: true })).toBeVisible();
  // The maker-checker transition is reflected back in the detail badge.
  await expect(dialog.getByText('Documents under review').first()).toBeVisible();
});

test('TeamRoute blocks a Packers staffer from the Valuation desk', async ({ page, login }) => {
  await login.asStaff('Packers');
  await page.goto('/ops/valuation');

  // TeamRoute → /ops?denied=valuation; the dashboard shows the denied banner.
  await expect(page).toHaveURL(/\/ops\?denied=valuation/);
  const banner = page.getByRole('alert').filter({ hasText: /don't have access/i });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Valuation')).toBeVisible();
  // The Valuation queue heading must NOT have rendered.
  await expect(page.getByRole('heading', { name: 'Property Valuation' })).toHaveCount(0);
});

test('an unauthenticated visitor is redirected from /ops/valuation to staff-login', async ({ page }) => {
  await page.goto('/ops/valuation');

  // RoleRoute → Navigate to /staff-login (no ops content rendered).
  await expect(page).toHaveURL(/\/staff-login/);
  await expect(page.getByRole('button', { name: 'Valuation', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Property Valuation' })).toHaveCount(0);
});

test('the queue shows an empty state when a search matches nothing', async ({ page, login }) => {
  await login.asStaff('Valuation');
  await page.goto('/ops/valuation');
  await expect(page.getByRole('heading', { name: 'Property Valuation' })).toBeVisible();

  await page.getByPlaceholder(/Search customer/i).fill('zzz-no-such-request');
  await expect(page.getByRole('table').getByText('No Property Valuation requests')).toBeVisible();
  // Unscoped on purpose: a filtered-out request must leave neither copy behind.
  await expect(page.getByText('Deepak Shah')).toHaveCount(0);
});
