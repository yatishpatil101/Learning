import { test, expect } from '../../fixtures/base.js';

// Admin Staff Activity — /admin/staff-activity
// Guarded by RoleRoute roles=['admin','manager'] + ModuleRoute moduleKey="staffActivity".
// Source: frontend/src/pages/admin/AdminStaffActivity.jsx (+ lib/mockApi/staff.js).
//
// staffActivity is NOT seeded in db.json, so a fresh session shows the empty
// leaderboard + empty table. To exercise the KPIs, leaderboard and filters we
// inject a small, deterministic activity log into the mock DB (key puneNestDB_v5)
// after the app has booted and seeded — mirroring what logStaffActivity() writes
// when staff actually perform Post-on-Behalf / service actions.

const DB_KEY = 'puneNestDB_v5';

const ACTIVITY = [
  { id: 'SA1', staffName: 'Anita Rao', staffTeam: 'rental', category: 'listing', action: 'post-on-behalf', detail: 'Posted 2 BHK in Baner on behalf of owner', listingId: 'PRC001' },
  { id: 'SA2', staffName: 'Anita Rao', staffTeam: 'rental', category: 'listing', action: 'post-on-behalf', detail: 'Posted 3 BHK Villa in Wakad on behalf of owner' },
  { id: 'SA3', staffName: 'Vikram Singh', staffTeam: 'legal', category: 'service', action: 'legal', detail: 'Completed legal verification for Kharadi flat' },
  { id: 'SA4', staffName: 'Vikram Singh', staffTeam: 'legal', category: 'service', action: 'rent-agreement', detail: 'Drafted rent agreement for Baner tenant' },
  { id: 'SA5', staffName: 'Meena Iyer', staffTeam: 'interior', category: 'service', action: 'interior', detail: 'Scheduled interior consult for Wakad villa' },
];

// Inject the activity log into the already-seeded mock DB, then open the desk.
async function seedActivity(page) {
  await page.evaluate(({ key, rows }) => {
    // Read-modify-write — `|| '{}'` would write an empty DB back over the seeded catalogue,
    // and the desk would then be empty for a reason that has nothing to do with activity.
    const raw = localStorage.getItem(key);
    if (!raw) throw new Error('mock store missing');
    const db = JSON.parse(raw);
    const now = Date.now();
    db.staffActivity = rows.map((r, i) => ({
      ...r,
      at: new Date(now - (i + 1) * 3600000).toISOString(),
      staffRole: 'staff',
      staffMobile: '90000000' + i,
    }));
    localStorage.setItem(key, JSON.stringify(db));
  }, { key: DB_KEY, rows: ACTIVITY });
}

test('admin loads the Staff Activity desk with KPIs, leaderboard and activity table', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await seedActivity(page);
  await page.goto('/admin/staff-activity');

  await expect(page.getByRole('heading', { name: 'Staff Activity' })).toBeVisible();
  await expect(page.getByText('Track staff performance — listings posted, services handled & more')).toBeVisible();

  // KPI summary tiles.
  await expect(page.getByText('Total activities', { exact: true })).toBeVisible();
  await expect(page.getByText('Listings posted', { exact: true })).toBeVisible();
  await expect(page.getByText('Services handled', { exact: true })).toBeVisible();
  await expect(page.getByText('Active staff', { exact: true })).toBeVisible();

  // Leaderboard renders one card per staff member (top performer first).
  await expect(page.getByRole('heading', { name: 'Staff Leaderboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Anita Rao/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Vikram Singh/ })).toBeVisible();

  // Filters bar counter + paginated table both reflect all 5 activities.
  await expect(page.getByText('5 of 5', { exact: true })).toBeVisible();
  await expect(page.getByText('Showing 1–5 of 5 activities')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('category filter narrows the activity table to listing actions', async ({ page, login }) => {
  await login.asAdmin();
  await seedActivity(page);
  await page.goto('/admin/staff-activity');

  await expect(page.getByText('5 of 5', { exact: true })).toBeVisible();

  // Open the custom "Filter by category" dropdown and pick Listings.
  await page.getByLabel('Filter by category').click();
  await page.getByRole('option', { name: 'Listings', exact: true }).click();

  // Only the two listing activities remain (both service rows filtered out).
  await expect(page.getByText('2 of 5', { exact: true })).toBeVisible();
  await expect(page.getByText('Showing 1–2 of 2 activities')).toBeVisible();
  await expect(page.locator('table').getByText('Vikram Singh')).toHaveCount(0);
});

test('clicking a leaderboard card filters to that staff member, Clear resets it', async ({ page, login }) => {
  await login.asAdmin();
  await seedActivity(page);
  await page.goto('/admin/staff-activity');

  await page.getByRole('button', { name: /Anita Rao/ }).click();

  // Anita has 2 of the 5 activities; the table drops everyone else.
  await expect(page.getByText('2 of 5', { exact: true })).toBeVisible();
  await expect(page.locator('table').getByText('Meena Iyer')).toHaveCount(0);

  // The Clear pill appears once a filter is active and resets the view.
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText('5 of 5', { exact: true })).toBeVisible();
});

test('shows the empty leaderboard + table when no staff activity has been logged', async ({ page, login }) => {
  await login.asAdmin();
  // No seeding: staffActivity is empty by default.
  await page.goto('/admin/staff-activity');

  await expect(page.getByRole('heading', { name: 'Staff Activity' })).toBeVisible();
  await expect(page.getByText('No activity recorded yet. Staff actions will appear here.')).toBeVisible();
  await expect(page.getByRole('cell', { name: /No staff activity recorded yet/ })).toBeVisible();
  await expect(page.getByText('0 of 0', { exact: true })).toBeVisible();
});

test('unauthenticated visitor is redirected to staff-login', async ({ page }) => {
  await page.goto('/admin/staff-activity');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Staff Activity' })).toHaveCount(0);
});

test('a buyer cannot open the admin Staff Activity desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/staff-activity');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Staff Activity' })).toHaveCount(0);
});
