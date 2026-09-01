/* The back-office review surface, against the live API.
 *
 * Replaces the mock `staff-activity.spec.js`. Six tests become six, but only two of them are the
 * same test — and the reason is the point of the whole change. The mock read a parallel activity log
 * the frontend wrote to localStorage, so every one of its assertions was about rows the browser had
 * put there itself. There was no way for it to be wrong about the platform, because it was never
 * asking about the platform.
 *
 * So the fixture here is not a seeded array. It is *doing back-office work through the console* and
 * then asserting the record of it shows up. That is the only way to test a projection of the audit
 * log: if the row does not appear, either the action was not audited or the feed does not read what
 * the platform writes, and both are the failure this page exists to catch.
 *
 * Two dropped rather than ported:
 * - `shows the empty leaderboard + table when no staff activity has been logged` — it cleared
 *   localStorage to force the empty state. There is no equivalent gesture against a shared audit
 *   log, and there should not be, so the empty state is reached below through a filter instead.
 * - `category filter narrows the activity table to listing actions` — the mock's two categories
 *   ('listing', 'service') do not exist on the server, which categorises by the kind of record acted
 *   on. Its replacement checks the *vocabulary* the picker offers, which is where the mock was
 *   actually wrong: two of its six action filters named things that were never audit actions.
 */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/**
 * Do two auditable things and leave the platform exactly as it was found.
 *
 * Suspend then reactivate is the only shape that works here. The audit log is append-only and the
 * live database is not reset between tests, so a test that only suspended would leave the next test
 * unable to suspend the same person — and picking a fresh victim per test runs out of seeded
 * accounts fast. A matched pair writes two rows and restores the account.
 *
 * Every name passed in must be unique across the whole directory. The seed has two Isha Mehtas, and
 * `.first()` will happily hand back the one this call did not just act on — which surfaces as the
 * toggle "not changing", fifteen seconds later, with a locator error that points at the button.
 */
async function twoDecisionsAbout(page, name) {
  /* One page load per decision. The button is a toggle — the same cell says "Suspend" or
     "Reactivate" depending on the status the server last reported — so clicking it twice in place is
     a race against the directory's own refresh, and a locator cannot tell "not re-rendered yet" from
     "not there". Reloading costs a second and removes the question. */
  for (const verb of ['Suspend', 'Reactivate']) {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await page.getByPlaceholder('Search name, mobile, email…').fill(name);

    const row = page.locator('table').getByRole('row', { name: new RegExp(name) }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: verb, exact: true }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeHidden();
  }
}

async function openActivity(page) {
  await page.goto('/admin/staff-activity');
  await expect(page.getByRole('heading', { name: 'Staff Activity', exact: true })).toBeVisible();
  // The count caption stops saying "Loading…" once the feed has answered.
  await expect(page.getByText('Loading…')).toHaveCount(0);
}

const rows = (page) => page.locator('table tbody tr');
const total = (page) => page.getByTestId('kpi-total');

test('the desk renders, and an impossible search reaches the empty state honestly', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openActivity(page);

  await expect(page.getByText('Total activities')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Staff Leaderboard' })).toBeVisible();

  /* The mock forced this state by wiping the browser's storage. There is no such gesture against a
     shared, append-only audit log — so ask it for something that cannot exist instead. Scoped to the
     table because `Table` renders the mobile card for the same empty state first. */
  await page.getByRole('textbox', { name: 'Search staff activity' }).fill('zzz-no-such-actor');
  await expect(page.locator('table').getByText('No staff activity in this window.')).toBeVisible();
  await expect(total(page)).toHaveText('0');

  expect(consoleErrors).toHaveLength(0);
});

test('a moderation decision taken in the console shows up in the record of it', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await twoDecisionsAbout(page, 'Meera Joshi');

  await openActivity(page);

  /* Not a row this test wrote. The server wrote it, inside the transaction that suspended the
     account, and the page is reading that write back. */
  const row = page.locator('table').getByRole('row', { name: /suspend/ }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText('user', { exact: true })).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test('the actor is named, not printed as an id', async ({ page, login }) => {
  await login.asAdmin();
  await twoDecisionsAbout(page, 'Aditya Sharma');

  await openActivity(page);

  /* `audit_log.actor` holds a UUID. Resolving it back to the person is the difference between a
     review surface and a table of hex. Scoped to the first cell: the Record column *does* print a
     raw id, and rightly so — that one is the thing acted on, and there is nothing friendlier to
     show. The one that has to be a name is the person. */
  const row = page.locator('table').getByRole('row', { name: /suspend/ }).first();
  const who = row.locator('td').first();
  await expect(who.getByText('Admin', { exact: true })).toBeVisible();
  await expect(who).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
});

test('the totals are counted by the server, not by the rows on screen', async ({ page, login }) => {
  await login.asAdmin();

  await openActivity(page);
  const before = Number((await total(page).innerText()).replace(/\D/g, ''));

  await twoDecisionsAbout(page, 'Gauri Mehta');
  await openActivity(page);

  /* Two decisions, two rows, whichever page of the feed they land on. The old page folded this
     number out of the rows it had already fetched, which made "total activities" a fact about the
     browser rather than about the platform. */
  await expect(total(page)).toHaveText(String(before + 2));
  await expect(page.getByTestId('kpi-staff')).not.toHaveText('0');
});

test('the action filter offers only verbs the platform has actually recorded', async ({ page, login }) => {
  await login.asAdmin();
  await twoDecisionsAbout(page, 'Nikhil Jain');

  await openActivity(page);

  /* The options come from the summary, so they are the distinct actions in the window. The mock
     hardcoded six, including `packers` and `interior` — service categories that were never audit
     actions, so two of its filters could only ever return an empty table. */
  await page.getByRole('button', { name: /Filter by action/ }).click();
  await expect(page.getByRole('option', { name: 'suspend' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'packers' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'interior' })).toHaveCount(0);
});

test('clicking a leaderboard card narrows the feed to that colleague, and Clear restores it', async ({ page, login }) => {
  await login.asAdmin();
  await twoDecisionsAbout(page, 'Omkar Kulkarni');

  await openActivity(page);
  const everyone = await rows(page).count();

  const card = page.getByRole('button', { name: /Admin/ }).first();
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(rows(page).first()).toContainText('Admin');

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  await expect(rows(page)).toHaveCount(everyone);
});

test('staff cannot read the record that exists to hold them to account', async ({ page, login }) => {
  await login.asStaff();

  /* The audit log is administrator-only for this reason, and this page reads the same table. Two
     doors into the same rows with different locks is one lock. */
  await page.goto('/admin/staff-activity');
  await expect(page.getByRole('heading', { name: 'Staff Activity', exact: true })).toHaveCount(0);
});

/*
   Turning the module off, from where it is actually turned off.

   `post-on-behalf.spec.js` owned this claim and reached it by writing
   `settings.adminFlags.staffActivity.enabled = false` straight into `draazyDB_v5`. That flag is
   not browser state: `AdminFlagsContext` reads it out of `GET /admin/settings` and every admin in
   the company sees the same value. The mock version was editing a local copy of a shared server
   document, so it proved the *component* branches on a boolean it was handed, and nothing about
   whether the switch an operator flips is connected to the branch.

   Written here rather than in `live-settings-console` because the interesting half is the payoff,
   not the write: a module that has been disabled must say so and offer the way back. The failure
   this catches is a blank pane — the same pixels a broken fetch produces, which is exactly the
   wrong thing to show somebody who is about to file a bug about a page that "stopped working".
*/
test('a disabled module explains itself instead of rendering nothing', async ({ page, login }) => {
  const flag = { adminFlags: { staffActivity: { enabled: false } } };

  /* `PUT` merges rather than replaces, so this patch is the one key and leaves the rest of the
     document — the fee table, the permission map, every other flag — untouched. `try/finally`
     rather than an `afterEach` because this is the only test in the file that writes settings, and
     the restore has to run even when an assertion below throws: a lane that left the audit log
     switched off would take the other six tests here down with it on the next run. */
  const res = await fetch(`${API}/admin/settings`, {
    method: 'PUT', headers: await authHeaders(ACTORS.admin), body: JSON.stringify(flag),
  });
  expect(res.status, 'could not disable the module through the settings route').toBe(200);

  try {
    await login.asAdmin();
    await page.goto('/admin/staff-activity');

    await expect(page.getByText('Staff Activity module is disabled.')).toBeVisible();
    /* And the way out. A dead end here means an administrator who has to be told, by somebody else,
       which of forty switches to look for. */
    await expect(page.getByRole('link', { name: /Enable in Settings/i })).toBeVisible();

    /* The control that stops this passing on a page that simply failed to load. Every assertion
       above is satisfied by a screen that renders the fallback for the wrong reason, so the feed's
       own furniture has to be gone rather than merely un-found: the table and the KPI the first
       test in this file asserts are present. */
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.getByTestId('kpi-total')).toHaveCount(0);
  } finally {
    const back = await fetch(`${API}/admin/settings`, {
      method: 'PUT',
      headers: await authHeaders(ACTORS.admin),
      body: JSON.stringify({ adminFlags: { staffActivity: { enabled: true } } }),
    });
    expect(back.status, 'the module was left disabled for every other admin').toBe(200);
  }

  /* Re-enabled, and proved so through the screen rather than through the response above: the read
     path is a different one (`AdminFlagsContext` merges the document into its defaults), and a
     restore that satisfied the API while leaving the console dark is the leak this whole block
     exists to avoid. */
  await page.goto('/admin/staff-activity');
  await expect(page.getByRole('heading', { name: 'Staff Activity', exact: true })).toBeVisible();
});

