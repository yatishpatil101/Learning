import { test, expect } from '../../fixtures/base.js';

// Admin Content desk — /admin/content
// Guarded by RoleRoute roles=['admin'] (redirect -> /staff-login) +
// ModuleRoute moduleKey="content". Source: frontend/src/pages/admin/AdminContent.jsx.
//
// Seeded content (frontend/src/data/db.json): 2 banners, 9 FAQs, 2 announcements,
// 12 reviews (7 pending / 5 published). Tabs = Banners | FAQs | Announcements |
// Reviews. Add/edit runs through a Modal and fires a "Saved" toast (role="alert");
// review Approve/Reject flips status inline with an "Approved"/"Rejected" toast.

test('admin loads the Content desk with all four tabs and the banners view', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/content');

  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible();

  // Tab bar.
  await expect(page.getByRole('button', { name: 'Banners', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'FAQs', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Announcements', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reviews', exact: true })).toBeVisible();

  // Default tab (banners) shows its blurb + add control + seeded banner.
  await expect(page.getByText(/\d+ active, \d+ archived/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add banner' })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('the Reviews tab renders the paginated moderation table', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/content');

  await page.getByRole('button', { name: 'Reviews', exact: true }).click();

  // 12 seeded reviews, pageSize 10.
  await expect(page.getByText(/Showing 1–10 of 12 reviews/)).toBeVisible();
});

test('adding a banner saves it and fires a toast', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/content');

  await page.getByRole('button', { name: 'Add banner' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add banner' });
  await expect(dialog).toBeVisible();

  // Title is the first field in the banner form (no label association).
  await dialog.getByRole('textbox').first().fill('E2E Test Banner');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('alert')).toContainText('Saved');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('E2E Test Banner')).toBeVisible();
});

test('approving a pending review confirms with a toast', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/content');

  await page.getByRole('button', { name: 'Reviews', exact: true }).click();

  // Pending reviews expose an Approve control; publishing removes it from that row.
  await page.getByRole('button', { name: 'Approve' }).first().click();

  await expect(page.getByRole('alert')).toContainText('Approved');
});

test('the FAQs tab lists seeded questions with an add control', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/content');

  await page.getByRole('button', { name: 'FAQs', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Add FAQ' })).toBeVisible();
  await expect(page.getByText('Is PuneNest really zero brokerage?')).toBeVisible();
});

test('unauthenticated visitor is redirected to staff-login', async ({ page }) => {
  await page.goto('/admin/content');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Content' })).toHaveCount(0);
});

test('a buyer cannot open the admin content desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/content');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Content' })).toHaveCount(0);
});
