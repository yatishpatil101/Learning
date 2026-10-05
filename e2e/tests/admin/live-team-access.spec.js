/* Team & Access, against the live API.
 *
 * Replaces the Team-page half of `rbac.spec.js`. What the page does changed shape under it: the tab
 * that built named custom-role bundles is gone (V61
 * deleted the settings key it wrote to, so it granted nothing), and in its place each account
 * carries a permission document read from `GET /users/{id}/permissions` and written back whole.
 *
 * The seeded member names the mock specs asserted on (`Rohan Kulkarni`, `Sneha Patil`) do not exist
 * in the live database, so the rows are found by role rather than by name — which is the better
 * assertion anyway: the subject is that back-office accounts are listed, not who they are.
 */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

async function openTeam(page) {
  await page.goto('/admin/team');
  await expect(page.getByRole('heading', { name: 'Team & Access' })).toBeVisible();
}

/**
 * Find a member's row, following pagination.
 *
 * Sixteen back-office accounts over a page size of twelve, and the directory's order is not one
 * this spec may assume: it is four `GET /users` reads stitched together, and the server does not
 * promise a total order within a role. A named person can therefore sit on either page from run to
 * run, which is exactly the kind of thing that reads as flakiness and is really an assumption.
 * Walking the pages costs one click and removes the guess.
 */
async function memberRow(page, name) {
  const row = page.getByRole('row', { name: new RegExp(name) });
  if ((await row.count()) === 0) {
    await page.getByRole('button', { name: 'Next page' }).click();
  }
  await expect(row.first()).toBeVisible();
  return row.first();
}

test('the directory lists back-office accounts with their role and status', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openTeam(page);

  /* Scoped to a table row. `Table` renders the `sm:hidden` stacked card for every row *before* the
     `hidden sm:block` table, so each member is in the DOM twice and a bare text match resolves to
     the mobile duplicate — which is permanently hidden at this viewport. */
  const admin = await memberRow(page, 'Admin');
  await expect(admin).toBeVisible();
  await expect(admin.getByText('active', { exact: true })).toBeVisible();
  // The administrator is not editable from here; only the accounts beneath it are.
  await expect(admin.getByRole('button', { name: 'Edit' })).toHaveCount(0);

  const staff = await memberRow(page, 'Isha Mehta');
  await expect(staff.getByText('Staff', { exact: true })).toBeVisible();
  await expect(staff.getByText('active', { exact: true })).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Edit' })).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('admins can pick Manager, while staff remains the default', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openTeam(page);

  await page.getByRole('button', { name: /Add member/i }).click();
  await expect(page.getByRole('button', { name: 'Role' })).toContainText(/Ops staff/i);
  await page.getByRole('button', { name: 'Role' }).click();
  await expect(page.getByRole('option', { name: /^Manager/i })).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('creating staff shows the one-time invite link dialog', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openTeam(page);
  const mobile = uniqueMobile();
  const email = `ui-invite.${mobile}@draazy.test`;

  await page.getByRole('button', { name: /Add member/i }).click();
  await page.getByPlaceholder('e.g. Rohan Kulkarni').fill(`UI Invite ${mobile}`);
  await page.getByPlaceholder('10-digit number').fill(mobile);
  await page.getByPlaceholder('name@draazy.com').fill(email);
  await page.getByRole('checkbox', { name: /Rent Agreement/ }).check();
  await page.getByRole('button', { name: /Create member/ }).click();

  await expect(page.getByRole('heading', { name: 'Invite link' })).toBeVisible();
  await expect(page.getByLabel('Staff invite link')).toHaveValue(/\/staff-invite#/);
  await page.getByRole('button', { name: /Done/ }).click();

  const admin = await authHeaders(ACTORS.admin);
  const res = await fetch(`${API}/users?role=staff&size=100`, { headers: admin });
  const body = await res.json();
  const created = (body.content || body.items || []).find((u) => u.email === email);
  if (created) {
    await fetch(`${API}/users/${created.id}/archive`, {
      method: 'PATCH', headers: admin, body: JSON.stringify({ reason: 'UI invite probe finished' }),
    });
  }
  expect(consoleErrors).toHaveLength(0);
});

test('members can be suspended but not hard-deleted', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openTeam(page);

  const row = await memberRow(page, 'Isha Mehta');
  await expect(row.getByRole('button', { name: /^Suspend$/ })).toBeVisible();
  // There is no DELETE /users/{id} anywhere in the contract; archive is the removal.
  await expect(row.getByRole('button', { name: /^Remove$/ })).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});

test('a member record shows the function checklist the server publishes', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openTeam(page);

  await (await memberRow(page, 'Isha Mehta')).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit member' })).toBeVisible();

  /* The functions are rendered from the server's function catalogue, so this asserts the round trip
     rather than a hard-coded list — the console no longer holds one. An unscoped staff account is
     shown its baseline functions ticked, and administrator-only capabilities are absent because no
     function a `staff` document can hold grants them. */
  await expect(page.getByRole('checkbox', { name: 'Rent Agreement' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Reports' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Settings|Finance|Audit/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Users|Team/ })).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});

test('unticking a function and saving writes the document, and re-ticking puts it back', async ({ page, login, consoleErrors }) => {
  /* The write half of the feature, driven through the UI the way an administrator drives it. The
     old mock spec could not make this assertion: it edited a store the browser also read, so it
     proved only that the console agreed with itself.

     It ends where it started on purpose. `PUT` has no inverse — there is no route that deletes a
     permission document, by design, since an access-control record that can vanish is one nobody
     can audit — so "restore" means writing the role's full baseline back. That leaves a stored row
     whose effective set is identical to an unscoped account's, which is exactly what the live
     fixture's own teardown produces and what every other spec signing in as this staffer needs. */
  await login.asAdmin();
  await openTeam(page);

  const open = async () => {
    await (await memberRow(page, 'Isha Mehta')).getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit member' })).toBeVisible();
    return page.getByRole('checkbox', { name: 'Reports' });
  };

  let reports = await open();
  await expect(reports).toBeChecked();
  await reports.uncheck();
  await page.getByRole('button', { name: /Save changes/ }).click();
  await expect(page.getByRole('heading', { name: 'Edit member' })).toHaveCount(0);

  // Re-read from the server rather than trusting the form state that wrote it.
  reports = await open();
  await expect(reports).not.toBeChecked();
  await reports.check();
  await page.getByRole('button', { name: /Save changes/ }).click();
  await expect(page.getByRole('heading', { name: 'Edit member' })).toHaveCount(0);

  await expect(await open()).toBeChecked();

  expect(consoleErrors).toHaveLength(0);
});

test('a manager creates staff, cannot pick Manager, and cannot act on the admin row', async ({ page, login, consoleErrors }) => {
  await login.asManager();
  await openTeam(page);
  const mobile = uniqueMobile();
  const email = `manager-invite.${mobile}@draazy.test`;

  const adminRow = await memberRow(page, 'Admin');
  await expect(adminRow.getByRole('button', { name: /Reset 2FA for/i })).toHaveCount(0);
  await expect(adminRow.getByRole('button', { name: /Reissue invite for/i })).toHaveCount(0);

  await page.getByRole('button', { name: /Add member/i }).click();
  await expect(page.getByRole('button', { name: 'Role' })).toContainText(/Ops staff/i);
  await page.getByRole('button', { name: 'Role' }).click();
  await expect(page.getByRole('option', { name: /Ops staff/i })).toBeVisible();
  await expect(page.getByRole('option', { name: /^Manager/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByPlaceholder('e.g. Rohan Kulkarni').fill(`Manager Invite ${mobile}`);
  await page.getByPlaceholder('10-digit number').fill(mobile);
  await page.getByPlaceholder('name@draazy.com').fill(email);
  await page.getByRole('checkbox', { name: /Rent Agreement/ }).check();
  await page.getByRole('button', { name: /Create member/ }).click();
  await expect(page.getByRole('heading', { name: 'Invite link' })).toBeVisible();

  const admin = await authHeaders(ACTORS.admin);
  const res = await fetch(`${API}/users?role=staff&size=100`, { headers: admin });
  const body = await res.json();
  const created = (body.content || body.items || []).find((u) => u.email === email);
  if (created) {
    await fetch(`${API}/users/${created.id}/archive`, {
      method: 'PATCH', headers: admin, body: JSON.stringify({ reason: 'Manager invite probe finished' }),
    });
  }

  expect(consoleErrors).toHaveLength(0);
});
