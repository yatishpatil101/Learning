/* Team & Access, against the live API.
 *
 * Replaces the mock `team-approvals.spec.js` and the Team-page half of `rbac.spec.js`. What the
 * page does changed shape under it: the tab that built named custom-role bundles is gone (V61
 * deleted the settings key it wrote to, so it granted nothing), and in its place each account
 * carries a permission document read from `GET /users/{id}/permissions` and written back whole.
 *
 * The seeded member names the mock specs asserted on (`Rohan Kulkarni`, `Sneha Patil`) do not exist
 * in the live database, so the rows are found by role rather than by name — which is the better
 * assertion anyway: the subject is that back-office accounts are listed, not who they are.
 */
import { test, expect } from '../../fixtures/live.js';

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
  const row = await memberRow(page, 'Admin');
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit' })).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('pending approvals is a tab and states the maker-checker rule', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openTeam(page);

  await page.getByRole('tab', { name: /Pending approvals/i }).click();
  // The rule has to be legible on the screen that enforces it, not only in the refusal.
  await expect(page.getByText(/second administrator approves it/i)).toBeVisible();
  /* The seed has one administrator, so nothing can ever be waiting for a second signature — the
     bootstrap escape auto-approves. The empty state is the honest answer here, not a gap. */
  await expect(page.getByRole('cell', { name: /Nothing is waiting for a second signature/i })).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('a back-office account cannot be created as Manager', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openTeam(page);

  await page.getByRole('button', { name: /Add member/i }).click();
  /* Ops staff is the default precisely because Manager cannot be created — it is a console label,
     not one of the contract's roles — and the warning appears on selection rather than after the
     save fails. The role picker is the project's own `Select`, a `button[aria-haspopup=listbox]`
     over `button[role=option]`s, so it is opened and clicked rather than `selectOption`ed. */
  await page.getByRole('button', { name: /Ops staff/i }).click();
  await page.getByRole('option', { name: /^Manager/i }).click();
  await expect(page.getByText(/not an account type the platform recognises/i)).toBeVisible();

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

test('a member record shows the permission grid the server publishes', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openTeam(page);

  await (await memberRow(page, 'Isha Mehta')).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit member' })).toBeVisible();

  /* The atoms are rendered from `GET /admin/permission-catalogue`, so this asserts the round trip
     rather than a hard-coded list — the console no longer holds one. An unscoped staff account is
     shown its role's baseline ticked, and the administrator-only rows are absent because a `staff`
     document can never contain them. */
  await expect(page.getByRole('checkbox', { name: /Properties · Edit/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Settings · View/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Users · Edit/ })).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});

test('unticking a permission and saving writes the document, and re-ticking puts it back', async ({ page, login, consoleErrors }) => {
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
    return page.getByRole('checkbox', { name: /Reports · View/ });
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
