import { test, expect } from '../../fixtures/base.js';

// Admin Flatmate moderation — /admin/flatmates
// Guarded by RoleRoute roles=['admin','manager'] + ModuleRoute moduleKey="flatmates"
// + FlagRoute flag="flatmates". Source: frontend/src/pages/admin/AdminFlatmates.jsx.
//
// Seeded data (src/data/db.json): 8 seekers (SK6 "Pooja" flagged), 5 groups
// (SG4 flagged), 3 group applications. Moderation actions call mutateDb + toast;
// Flag/Remove also open a window.prompt for an optional internal note.

const DB_KEY = 'puneNestDB_v5';

test('admin loads the Flatmate desk with KPIs, tabs and the seekers table', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/flatmates');

  await expect(page.getByRole('heading', { name: 'Flatmate' })).toBeVisible();
  await expect(page.getByText('Moderate flatmate seekers, groups & applications.')).toBeVisible();

  // Tabs (desktop labels) for each moderation queue.
  await expect(page.getByRole('button', { name: 'Seekers', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Groups', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Group Applications', exact: true })).toBeVisible();

  // Seekers is the default tab: 8 seeded seekers, columns unique to that table.
  await expect(page.getByRole('columnheader', { name: 'Seeker', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Verified', exact: true })).toBeVisible();
  await expect(page.getByText('Showing 1–8 of 8 seekers')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('switching tabs syncs the URL and swaps the moderation table', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/flatmates');

  // Groups tab.
  await page.getByRole('button', { name: 'Groups', exact: true }).click();
  await expect(page).toHaveURL(/tab=groups/);
  await expect(page.getByRole('columnheader', { name: 'Open to', exact: true })).toBeVisible();
  await expect(page.getByText('Showing 1–5 of 5 groups')).toBeVisible();

  // Group Applications tab.
  await page.getByRole('button', { name: 'Group Applications', exact: true }).click();
  await expect(page).toHaveURL(/tab=apps/);
  await expect(page.getByRole('columnheader', { name: 'Owner decision', exact: true })).toBeVisible();
  await expect(page.getByText('Showing 1–3 of 3 applications')).toBeVisible();
});

test('deep-linking ?tab=groups opens the Groups queue directly', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/flatmates?tab=groups');

  await expect(page.getByRole('columnheader', { name: 'Open to', exact: true })).toBeVisible();
  await expect(page.getByText('Showing 1–5 of 5 groups')).toBeVisible();
});

test('approving a flagged seeker transitions it to Live and fires a toast', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/flatmates');

  // SK6 "Pooja" is seeded as flagged, so it is the only seeker with an Approve
  // control (approve = set modStatus back to "live"; no prompt for this action).
  const row = page.locator('table tbody tr').filter({ hasText: 'Pooja' });
  await expect(row.getByRole('button', { name: 'Approve' })).toBeVisible();

  await row.getByRole('button', { name: 'Approve' }).click();

  await expect(page.getByRole('alert')).toContainText('Approved');
  // The row moderates to Live: Approve disappears, the status badge flips.
  await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(row.getByText('Live', { exact: true })).toBeVisible();
});

test('flagging a live seeker prompts for a note and marks it Flagged', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/flatmates');

  // Flag/Remove open a window.prompt for an optional internal note — dismiss it
  // (returns null → no note stored) so the moderation transition still runs.
  page.on('dialog', (d) => d.dismiss());

  const row = page.locator('table tbody tr').filter({ hasText: 'Riya' });
  await row.getByRole('button', { name: 'Flag' }).click();

  await expect(page.getByRole('alert')).toContainText('Flagged');
  await expect(row.getByText('Flagged', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Flag' })).toHaveCount(0);
});

test('shows empty states for every queue when there is nothing to moderate', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/flatmates');
  await expect(page.getByRole('heading', { name: 'Flatmate' })).toBeVisible();

  // Clear the seeded collections in the mock DB, then reload so the tables render
  // their empty states. seedFlatmatesDemo() will not re-seed (its run-once flag is
  // already set from the first boot).
  await page.evaluate((key) => {
    const db = JSON.parse(localStorage.getItem(key) || '{}');
    db.flatmateSeekers = [];
    db.flatmateGroups = [];
    db.groupApplications = [];
    localStorage.setItem(key, JSON.stringify(db));
  }, DB_KEY);
  await page.reload();

  await expect(page.getByRole('cell', { name: 'No seekers yet.' })).toBeVisible();

  await page.getByRole('button', { name: 'Groups', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'No groups yet.' })).toBeVisible();

  await page.getByRole('button', { name: 'Group Applications', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'No applications yet.' })).toBeVisible();
});

test('unauthenticated visitor is redirected to staff-login', async ({ page }) => {
  await page.goto('/admin/flatmates');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Flatmate' })).toHaveCount(0);
});

test('a buyer cannot open the admin Flatmate desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/flatmates');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Flatmate' })).toHaveCount(0);
});
