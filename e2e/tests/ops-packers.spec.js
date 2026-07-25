import { test, expect } from '../fixtures/base.js';

/* Ops Packers & Movers desk — OpsServiceQueue type="packers" (App.jsx
   /ops/packers behind TeamRoute team="packers"). Behaviour verified against
   OpsServiceQueue.jsx (SVC_CONFIG.packers) + serviceFlow.js seedService('packers'),
   which seeds two demo requests:
     - Rohan Gupta  → advanced to "docs_review"
     - Anjali Rao   → left at "submitted" (docs still to verify)
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

test('Packers staff land on their desk with the queue tiles and search', async ({ page, login, consoleErrors }) => {
  await login.asStaff('Packers');            // quick login → /ops/packers
  await expect(page).toHaveURL(/\/ops\/packers/);

  // OpsServiceQueue type="packers" → SVC_CONFIG.packers.title/subtitle.
  await expect(page.getByRole('heading', { name: 'Packers & Movers' })).toBeVisible();
  await expect(page.getByText('Survey, quote, move & delivery')).toBeVisible();
  // Status-tile filters + the queue search box.
  await expect(page.getByRole('button', { name: /Needs action/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Completed/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Search customer/i)).toBeVisible();
  // Seeded demo rows are present (packers summary is "from → to").
  await expect(page.getByText('Rohan Gupta')).toBeVisible();
  await expect(page.getByText('Anjali Rao')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('verifying documents advances a submitted request to "under review" with a toast', async ({ page, login }) => {
  await seedConsent(page);
  await login.asStaff('Packers');
  await page.goto('/ops/packers');

  // Open Anjali Rao's request (seeded at "submitted"). Row action opens the detail modal.
  const row = page.getByRole('row').filter({ hasText: 'Anjali Rao' });
  await row.getByRole('button', { name: 'Open' }).click();

  const dialog = page.getByRole('dialog', { name: /Packers & Movers · Anjali Rao/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Request submitted').first()).toBeVisible();

  // "Mark all verified" runs markDocsVerified → status submitted → docs_review + toast.
  await dialog.getByRole('button', { name: /Mark all verified/i }).click();
  await expect(page.getByText('Documents verified', { exact: true })).toBeVisible();
  // The maker-checker transition is reflected back in the detail badge.
  await expect(dialog.getByText('Documents under review').first()).toBeVisible();
});

test('TeamRoute blocks an Interior staffer from the Packers desk', async ({ page, login }) => {
  await login.asStaff('Interior');
  await page.goto('/ops/packers');

  // TeamRoute → /ops?denied=packers; the dashboard shows the denied banner.
  await expect(page).toHaveURL(/\/ops\?denied=packers/);
  const banner = page.getByRole('alert').filter({ hasText: /don't have access/i });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Packers & Movers')).toBeVisible();
  // The Packers queue heading must NOT have rendered.
  await expect(page.getByRole('heading', { name: 'Packers & Movers' })).toHaveCount(0);
});

test('an unauthenticated visitor is redirected from /ops/packers to staff-login', async ({ page }) => {
  await page.goto('/ops/packers');

  // RoleRoute → Navigate to /staff-login (no ops content rendered).
  await expect(page).toHaveURL(/\/staff-login/);
  await expect(page.getByRole('button', { name: 'Packers', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Packers & Movers' })).toHaveCount(0);
});

test('the queue shows an empty state when a search matches nothing', async ({ page, login }) => {
  await login.asStaff('Packers');
  await page.goto('/ops/packers');
  await expect(page.getByRole('heading', { name: 'Packers & Movers' })).toBeVisible();

  await page.getByPlaceholder(/Search customer/i).fill('zzz-no-such-request');
  await expect(page.getByText('No Packers & Movers requests')).toBeVisible();
  await expect(page.getByText('Rohan Gupta')).toHaveCount(0);
});
