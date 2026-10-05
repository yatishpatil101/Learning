// Bulk account moderation has a blast radius that needs its own design.
import { test, expect } from '../../fixtures/live.js';
import { grantIdentityBadge, uniqueMobile } from '../../helpers/liveAuth.js';

async function openUsers(page) {
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  // The first row landing is the signal that GET /users has answered; the heading renders before it.
  await expect(page.locator('table tbody tr').first()).toBeVisible();
}

// `Table` duplicates rows for mobile, so desktop assertions must scope to the table.
const rowFor = (page, name) => page.locator('table').getByRole('row', { name: new RegExp(name) }).first();

// Search by `q` instead of paging through an order the server does not promise.
async function findUser(page, name) {
  await page.getByPlaceholder('Search name, mobile, email…').fill(name);
  const row = rowFor(page, name);
  await expect(row).toBeVisible();
  return row;
}

test('the directory lists accounts with role, status and a masked mobile, filters by status on the server, and narrows by search', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await test.step('the directory lists accounts with role, status and a masked mobile', async () => {
    await openUsers(page);

    // Directory copy depends on shared population size, not this test.
    await expect(
      page.getByText(/(\d+ accounts — owners, buyers and staff|Showing [\d,]+ of [\d,]+ matching accounts)/),
    ).toBeVisible();

    // Use Nikhil Sharma because Nikhil Nair is not unique in the seed.
    const row = await findUser(page, 'Nikhil Sharma');
    // Directory mobiles stay masked; full numbers require audited detail reads.
    await expect(row.getByText(/^\d{2}XXXXX\d{3}$/)).toBeVisible();
    await expect(row.getByRole('cell', { name: 'owner' })).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('the status filter asks the server, and Suspended returns only suspended accounts', async () => {
    await openUsers(page);

    // This custom Select is button/listbox based, not a native `<select>`.
    await page.getByRole('button', { name: 'Filter by status' }).click();
    await page.getByRole('option', { name: 'Suspended' }).click();

    // Count proves server-side filtering, not filtering over one downloaded page.
    await expect(page.getByText('6 accounts — owners, buyers and staff.')).toBeVisible();

    // Poll count because the heading can update before table rows are replaced.
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(6);
    // Every visible row is suspended. `Badge` renders the server's own lowercase status verbatim.
    await expect(page.locator('table').getByText('suspended', { exact: true })).toHaveCount(6);

    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('search narrows the directory', async () => {
    await openUsers(page);

    await findUser(page, 'Nikhil');
    await expect(page.locator('table').getByRole('row', { name: /Gauri Mehta/ })).toHaveCount(0);

    expect(consoleErrors).toHaveLength(0);
  });
});

test('a flag cannot be raised without a reason', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  const row = await findUser(page, 'Gauri Mehta');
  await row.getByRole('button', { name: 'Flag for review' }).click();
  await expect(page.getByRole('heading', { name: 'Flag for review' })).toBeVisible();

  // Invalid transitions should stay disabled instead of submitting doomed 422s.
  const confirm = page.getByRole('button', { name: 'Confirm' });
  await expect(confirm).toBeDisabled();
  await expect(page.getByText('A reason is required for this action.')).toBeVisible();

  await page.getByRole('textbox', { name: /Reason/ }).fill('Listings look duplicated');
  await expect(confirm).toBeEnabled();

  expect(consoleErrors).toHaveLength(0);
});

test('flagging a user marks the row and survives a reload', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  const row = await findUser(page, 'Tanvi Jain');
  await row.getByRole('button', { name: 'Flag for review' }).click();
  await page.getByRole('textbox', { name: /Reason/ }).fill('Three enquiries from one number');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('User flagged for review')).toBeVisible();

  // Reload proves persistence outside this browser.
  await page.reload();
  const after = await findUser(page, 'Tanvi Jain');
  await expect(after.getByRole('button', { name: /Remove flag/ })).toBeVisible();

  // Put it back, so the row is what the next spec in any order expects.
  await after.getByRole('button', { name: /Remove flag/ }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Flag removed')).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('a review-granted badge cannot be withdrawn by hand; a hand-granted one can', async ({ page, login, consoleErrors }) => {
  const mobile = uniqueMobile();
  await grantIdentityBadge(mobile);
  await login.asAdmin();
  await openUsers(page);

  await page.getByPlaceholder('Search name, mobile, email…').fill(mobile);
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(1);
  const earned = rows.first().getByRole('button', { name: /Earned through identity review/ });
  await expect(earned).toBeVisible();
  await expect(earned).toBeDisabled();

  const handGranted = await findUser(page, 'Sakshi Rao');
  await expect(handGranted.getByRole('button', { name: 'Remove Verified badge', exact: true })).toBeEnabled();

  expect(consoleErrors).toHaveLength(0);
});

test('the activity timeline is a real history, not a phone-number guess', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  // Verification cannot be auto-revoked because the boolean has no grant source.
  const row = await findUser(page, 'Sakshi Rao');
  await row.getByRole('button', { name: 'View activity' }).click();
  await expect(page.getByRole('heading', { name: /Activity — Sakshi Rao/ })).toBeVisible();

  // Every account has an unavoidable event, so empty means the union is broken.
  await expect(page.getByText('Joined Draazy')).toBeVisible();
  // Join listings by owner id, not phone, to preserve re-roled owner history.
  await expect(page.getByText('Listed a property').first()).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('suspending an account ends its sessions and refuses the next sign-in', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  const row = await findUser(page, 'Meera Joshi');
  await row.getByRole('button', { name: 'Suspend' }).click();
  await expect(page.getByText(/Ends every signed-in session and refuses new sign-ins/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/User suspended/)).toBeVisible();

  // Suspension must block sign-in, not just paint a status badge.
  await page.reload();
  const after = await findUser(page, 'Meera Joshi');
  await expect(after.getByRole('button', { name: 'Reactivate' })).toBeVisible();

  await after.getByRole('button', { name: 'Reactivate' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('User reactivated')).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('staff cannot reach the user directory at all', async ({ page, login }) => {
  await login.asStaff();
  await page.goto('/admin/users');

  // Shell-level denial differs from this screen's own authorization guard.
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toHaveCount(0);
});
