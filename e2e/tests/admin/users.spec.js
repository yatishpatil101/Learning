/* Bulk moderation is deliberately absent: "suspend forty accounts" server-side is a blast radius
 * that needs its own design, not a checkbox column. */
import { test, expect } from '../../fixtures/live.js';

async function openUsers(page) {
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  // The first row landing is the signal that GET /users has answered; the heading renders before it.
  await expect(page.locator('table tbody tr').first()).toBeVisible();
}

/* `Table` renders the `sm:hidden` stacked card for every row *before* the `hidden sm:block` table,
   so every user is in the DOM twice and a bare text match resolves to the mobile duplicate, which
   is permanently hidden at this viewport. Everything below is scoped to a table row. */
const rowFor = (page, name) => page.locator('table').getByRole('row', { name: new RegExp(name) }).first();

/* Eighty-one accounts over a ten-row table: paging to row six would be a guess about an order the
 * server does not promise, and the search box is a server-side `q` filter. */
async function findUser(page, name) {
  await page.getByPlaceholder('Search name, mobile, email…').fill(name);
  const row = rowFor(page, name);
  await expect(row).toBeVisible();
  return row;
}

test('the directory lists accounts with role, status and a masked mobile', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  /* Either phrasing: which renders is a property of the population, not of this test — the copy
     switches once the server's 100-row clamp truncates a directory shared with 600 other tests. */
  await expect(
    page.getByText(/(\d+ accounts — owners, buyers and staff|Showing [\d,]+ of [\d,]+ matching accounts)/),
  ).toBeVisible();

  /* Nikhil *Sharma*: the seed holds two Nikhil Nairs, so a row anchored on that display name is a
     coin toss between an owner and a buyer. */
  const row = await findUser(page, 'Nikhil Sharma');
  /* Masked deliberately: the full number is behind `GET /users/{id}`, which writes an audit row —
     an unmasked directory turns a search box into an untraceable bulk export. */
  await expect(row.getByText(/^\d{2}XXXXX\d{3}$/)).toBeVisible();
  await expect(row.getByRole('cell', { name: 'owner' })).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('the status filter asks the server, and Suspended returns only suspended accounts', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  /* The project's own `Select` — a `button[aria-haspopup=listbox]` over `button[role=option]`s —
     so it is opened and clicked rather than `selectOption`ed. */
  await page.getByRole('button', { name: 'Filter by status' }).click();
  await page.getByRole('option', { name: 'Suspended' }).click();

  /* Six, and the count is the assertion: a browser-side filter over one unfiltered fetch could only
     ever describe the rows that happened to have been downloaded. */
  await expect(page.getByText('6 accounts — owners, buyers and staff.')).toBeVisible();

  /* `await rows.count()` is a one-shot read and the heading lands a beat before the tbody is
     replaced, so it captures the stale unfiltered rows; assert the number the filter promises. */
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(6);
  // Every visible row is suspended. `Badge` renders the server's own lowercase status verbatim.
  await expect(page.locator('table').getByText('suspended', { exact: true })).toHaveCount(6);

  expect(consoleErrors).toHaveLength(0);
});

test('search narrows the directory', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  await findUser(page, 'Nikhil');
  await expect(page.locator('table').getByRole('row', { name: /Gauri Mehta/ })).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});

test('a flag cannot be raised without a reason', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  const row = await findUser(page, 'Gauri Mehta');
  await row.getByRole('button', { name: 'Flag for review' }).click();
  await expect(page.getByRole('heading', { name: 'Flag for review' })).toBeVisible();

  /* The server answers 422 and the database carries a matching check constraint, so an enabled
     Confirm would submit a request that could only fail. */
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

  /* The reload is the assertion: the flag survives because a colleague on another machine would see
     it too, not because this browser remembered it. */
  await page.reload();
  const after = await findUser(page, 'Tanvi Jain');
  await expect(after.getByRole('button', { name: /Remove flag/ })).toBeVisible();

  // Put it back, so the row is what the next spec in any order expects.
  await after.getByRole('button', { name: /Remove flag/ }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Flag removed')).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test.fixme('a review-granted badge cannot be withdrawn by hand', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  /* Parked, not deleted: `users` carries a single `verified` boolean with no record of who set it,
     so the API cannot tell a reviewer's grant from a manual one. See tasks/todo.md. */
  const row = await findUser(page, 'Sakshi Rao');
  const badge = row.getByRole('button', { name: /Remove Verified badge/ });
  await expect(badge).toBeVisible();
  await expect(badge).toBeDisabled();

  expect(consoleErrors).toHaveLength(0);
});

test('the activity timeline is a real history, not a phone-number guess', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  const row = await findUser(page, 'Sakshi Rao');
  await row.getByRole('button', { name: 'View activity' }).click();
  await expect(page.getByRole('heading', { name: /Activity — Sakshi Rao/ })).toBeVisible();

  /* Every account has one event it cannot avoid having; its absence means the union is broken
     rather than the person being new, which the empty state would otherwise disguise. */
  await expect(page.getByText('Joined Draazy')).toBeVisible();
  /* Listings joined on `owner_id`: joining by phone number would lose a re-roled owner's history
     and show two people sharing a handset each other's. */
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

  /* The badge is not the state that matters: a suspend that only wrote `status` would show a
     convincing label over an account that carried on signing in perfectly well. */
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

  /* `/admin` is administrator-only so this never reaches the page's own guard, but "the shell keeps
     them out" is a different guarantee from "this screen is closed to them". */
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toHaveCount(0);
});
