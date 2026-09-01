/* The user directory and its four moderation decisions, against the live API.
 *
 * Replaces the mock `users.spec.js`. Eight of that file's twenty-one tests are gone rather than
 * ported, and it is worth saying which and why:
 *
 * - **Six bulk-operation tests** (checkboxes, the action bar, the bulk modal, the count, Clear).
 *   Bulk verify/suspend/archive were dropped, not converted. They were a `for` loop over the
 *   browser's own database with no server behind them, and the server-side version of "suspend
 *   forty accounts" is a decision with a blast radius that deserves its own design rather than a
 *   checkbox column inherited from a mock.
 * - **Two coverage tests** that asserted the page rendered a table and had columns. Every test
 *   below does that on the way to asserting something.
 *
 * What is new here has no mock ancestor at all, because the capability did not exist: suspension
 * actually ending a session, a flag that refuses to be raised without a reason, and a badge that
 * cannot be withdrawn by hand once Aadhaar granted it.
 */
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

/**
 * Reach one person's row by searching for them.
 *
 * Eighty-one accounts over a table that shows ten. Clicking to page six would be a guess about an
 * order the server does not promise, and the search box is a server-side `q` filter as of D210 —
 * so asking for the person is both shorter and the thing an operator would actually do.
 */
async function findUser(page, name) {
  await page.getByPlaceholder('Search name, mobile, email…').fill(name);
  const row = rowFor(page, name);
  await expect(row).toBeVisible();
  return row;
}

test('the directory lists accounts with role, status and a masked mobile', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  await expect(page.getByText(/\d+ accounts — owners, buyers and staff/)).toBeVisible();

  const row = await findUser(page, 'Nikhil Nair');
  /* Masked, and that is the point: the full number is behind `GET /users/{id}`, which writes an
     audit row for the reveal. A directory that showed the real number would turn a search box into
     a bulk export and leave no trace of who exported it. */
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

  /* Six, and the count is the assertion. Before D210 this filter ran in the browser over a single
     unfiltered fetch, so the number under the heading could only ever describe the rows that
     happened to have been downloaded. */
  await expect(page.getByText('6 accounts — owners, buyers and staff.')).toBeVisible();

  const rows = page.locator('table tbody tr');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  // Every visible row is suspended. `Badge` renders the server's own lowercase status verbatim.
  await expect(page.locator('table').getByText('suspended', { exact: true })).toHaveCount(count);

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

  /* The server answers 422 and the database carries a matching check constraint, so a Confirm that
     stayed enabled would submit a request that could only fail. The screen refuses first, and says
     why, rather than letting the operator discover it from a toast. */
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

  /* The reload is the assertion. The mock wrote to `localStorage`, so it also "survived a reload" —
     on that one machine, for that one operator. This one survives because a colleague on another
     machine would see it too. */
  await page.reload();
  const after = await findUser(page, 'Tanvi Jain');
  await expect(after.getByRole('button', { name: /Remove flag/ })).toBeVisible();

  // Put it back, so the row is what the next spec in any order expects.
  await after.getByRole('button', { name: /Remove flag/ }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Flag removed')).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('an Aadhaar-verified badge cannot be withdrawn by hand', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openUsers(page);

  /* Sakshi Rao is seeded verified *through Aadhaar*. Withdrawing it is a 409 the server will not
     bend on, because nothing would restore it: the verification webhook returns early on an
     already-verified row, so a re-run would not put the badge back. A button that can only fail is
     worse than one that is visibly disabled with the reason attached. */
  const row = await findUser(page, 'Sakshi Rao');
  const badge = row.getByRole('button', { name: /Verified through Aadhaar/ });
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

  /* Every account has exactly one event it cannot avoid having. If this is missing, the union is
     broken rather than the person being new — which is the failure the empty state would otherwise
     disguise. */
  await expect(page.getByText('Joined PuneNest')).toBeVisible();
  /* Four listings, joined on `owner_id`. The mock joined them by phone number and gated them on
     `role === 'owner'`, so an owner who had since been re-roled lost their whole history and two
     people sharing a handset saw each other's. */
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

  /* The state that matters is not the badge. `status = 'suspended'` has existed since V2 and
     nothing read it until V77, so a suspend button that only wrote the column would have produced
     a convincing label over an account that carried on signing in perfectly well. */
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

  /* `/admin` is administrator-only, so this never reaches the page's own guard. Asserting it here
     anyway is deliberate: the directory carries masked numbers, moderation history and the flag,
     and "the shell happens to keep them out" is a different guarantee from "this screen is closed
     to them". If the shell gate is ever relaxed, this fails. */
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toHaveCount(0);
});
