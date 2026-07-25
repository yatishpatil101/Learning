import { test, expect } from '../fixtures/base.js';

/* Ops Interior & Renovation desk — OpsServiceQueue type="interior" (App.jsx
   /ops/interior behind TeamRoute team="interior"). Behaviour verified against
   OpsServiceQueue.jsx (SVC_CONFIG.interior) + serviceFlow.js seedService('interior'),
   which seeds two demo requests:
     - Sahil Verma  → advanced to "draft_shared"
     - Priya Nair   → left at "submitted" (docs still to verify)
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

test('Interior staff land on their desk with the queue tiles and search', async ({ page, login, consoleErrors }) => {
  await login.asStaff('Interior');           // quick login → /ops/interior
  await expect(page).toHaveURL(/\/ops\/interior/);

  // OpsServiceQueue type="interior" → SVC_CONFIG.interior.title/subtitle.
  await expect(page.getByRole('heading', { name: 'Interior & Renovation' })).toBeVisible();
  await expect(page.getByText('From design consult to handover')).toBeVisible();
  // Status-tile filters + the queue search box.
  await expect(page.getByRole('button', { name: /Needs action/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Completed/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Search customer/i)).toBeVisible();
  // Seeded demo rows are present.
  await expect(page.getByText('Sahil Verma')).toBeVisible();
  await expect(page.getByText('Priya Nair')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('verifying documents advances a submitted request to "under review" with a toast', async ({ page, login }) => {
  await seedConsent(page);
  await login.asStaff('Interior');
  await page.goto('/ops/interior');

  // Open Priya Nair's request (seeded at "submitted"). Row action opens the detail modal.
  const row = page.getByRole('row').filter({ hasText: 'Priya Nair' });
  await row.getByRole('button', { name: 'Open' }).click();

  const dialog = page.getByRole('dialog', { name: /Interior & Renovation · Priya Nair/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Request submitted').first()).toBeVisible();

  // "Mark all verified" runs markDocsVerified → status submitted → docs_review + toast.
  await dialog.getByRole('button', { name: /Mark all verified/i }).click();
  await expect(page.getByText('Documents verified', { exact: true })).toBeVisible();
  // The maker-checker transition is reflected back in the detail badge.
  await expect(dialog.getByText('Documents under review').first()).toBeVisible();
});

test('TeamRoute blocks a Packers staffer from the Interior desk', async ({ page, login }) => {
  await login.asStaff('Packers');
  await page.goto('/ops/interior');

  // TeamRoute → /ops?denied=interior; the dashboard shows the denied banner.
  await expect(page).toHaveURL(/\/ops\?denied=interior/);
  const banner = page.getByRole('alert').filter({ hasText: /don't have access/i });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Interior')).toBeVisible();
  // The Interior queue heading must NOT have rendered.
  await expect(page.getByRole('heading', { name: 'Interior & Renovation' })).toHaveCount(0);
});

test('an unauthenticated visitor is redirected from /ops/interior to staff-login', async ({ page }) => {
  await page.goto('/ops/interior');

  // RoleRoute → Navigate to /staff-login (no ops content rendered).
  await expect(page).toHaveURL(/\/staff-login/);
  await expect(page.getByRole('button', { name: 'Interior', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Interior & Renovation' })).toHaveCount(0);
});

test('the queue shows an empty state when a search matches nothing', async ({ page, login }) => {
  await login.asStaff('Interior');
  await page.goto('/ops/interior');
  await expect(page.getByRole('heading', { name: 'Interior & Renovation' })).toBeVisible();

  await page.getByPlaceholder(/Search customer/i).fill('zzz-no-such-request');
  await expect(page.getByText('No Interior & Renovation requests')).toBeVisible();
  await expect(page.getByText('Sahil Verma')).toHaveCount(0);
});
