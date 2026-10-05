/* Back-office work done through the console, then assert the audit-log projection shows it: a missing row means
   the action was not audited or the feed does not read what the platform writes. */
import fs from 'node:fs';
import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';
import { approveListingWithFetch } from '../../helpers/moderation.js';

/** Suspend then reactivate restores the account: the audit log is append-only and not reset per test. Names must
 * be unique (the seed has two Isha Mehtas) or `.first()` picks the wrong row. */
async function twoDecisionsAbout(page, name) {
  /* One page load per decision: the button toggles, and a locator can't tell "not re-rendered" from "absent". */
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
  await page.goto('/admin/staff-activity?tab=log');
  await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toBeVisible();
  // The count caption stops saying "Loading…" once the feed has answered.
  await expect(page.getByText('Loading…')).toHaveCount(0);
}

const rows = (page) => page.locator('table tbody tr');
const total = (page) => page.getByTestId('kpi-total');

test('the console reads back what the platform audited: renders, empty state, the decision rows, named actors, server totals, the action vocabulary and staff filtering', async ({ page, login, consoleErrors }) => {
  test.slow();
  await login.asAdmin();

  await test.step('the desk renders, and an impossible search reaches the empty state honestly', async () => {
    await openActivity(page);

    await expect(page.getByText('Total activities')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Staff Leaderboard' })).toHaveCount(0);

    /* No gesture empties a shared append-only log, so ask for something that can't exist; scoped to the table
       because `Table` renders the mobile card for the same empty state first. */
    await page.getByRole('textbox', { name: 'Search staff activity' }).fill('zzz-no-such-actor');
    await expect(page.locator('table').getByText('No staff activity in this window.')).toBeVisible();
    await expect(total(page)).toHaveText('0');

    expect(consoleErrors).toHaveLength(0);
  });

  await openActivity(page);
  const before = Number((await total(page).innerText()).replace(/\D/g, ''));

  await twoDecisionsAbout(page, 'Meera Joshi');
  await openActivity(page);

  await test.step('a moderation decision taken in the console shows up in the record of it', async () => {
    /* Not a row this test wrote. The server wrote it, inside the transaction that suspended the
       account, and the page is reading that write back. */
    const row = page.locator('table').getByRole('row', { name: /suspend/ }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('user', { exact: true })).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  });

  await test.step('the actor is named, not printed as an id', async () => {
    /* `audit_log.actor` holds a UUID. Scoped to the first cell: the Record column *does* print a raw
       id, and rightly so; the one that has to be a name is the person. */
    const row = page.locator('table').getByRole('row', { name: /suspend/ }).first();
    const who = row.locator('td').first();
    await expect(who.getByText('Admin', { exact: true })).toBeVisible();
    await expect(who).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  await test.step('the totals are counted by the server, not by the rows on screen', async () => {
    // Two decisions, two rows, whichever page of the feed they land on.
    await expect(total(page)).toHaveText(String(before + 2));
    await expect(page.getByTestId('kpi-staff')).not.toHaveText('0');
  });

  await test.step('the action filter offers only verbs the platform has actually recorded', async () => {
    /* The options come from the summary, so they are the distinct actions in the window; `packers`
       and `interior` are service categories, never audit actions. */
    await page.getByRole('button', { name: /Filter by action/ }).click();
    await expect(page.getByRole('option', { name: 'suspend' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'packers' })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'interior' })).toHaveCount(0);
  });

  await test.step('picking a colleague narrows the feed to them, and Clear restores it', async () => {
    await openActivity(page);
    const everyone = await rows(page).count();

    await page.getByRole('button', { name: /Filter by staff/ }).click();
    await page.getByRole('option', { name: /Admin/ }).first().click();
    await expect(rows(page).first()).toContainText('Admin');

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(rows(page)).toHaveCount(everyone);
  });
});

async function approveOnePendingListing() {
  const headers = await authHeaders(ACTORS.admin);
  const queue = await fetch(`${API}/admin/properties?status=pending&size=1`, { headers });
  expect(queue.status, 'the moderation queue must be readable before anything can be approved').toBe(200);
  const target = ((await queue.json()).content || [])[0];
  expect(target, 'the e2e seed must contain at least one pending listing for this spec to act on').toBeTruthy();

  const reason = `activity-spec-${Date.now()}`;
  const patch = await approveListingWithFetch(target.id, headers, { reason });
  expect(patch.status, 'the approval itself must succeed, or the log has nothing to have recorded').toBe(200);
  return { target, reason };
}

test('the log carries the approval an admin took, with its reason, in the Details column', async ({ page, login }) => {
  const { target, reason } = await approveOnePendingListing();

  await login.asAdmin();
  await openActivity(page);
  await expect(page.getByRole('columnheader', { name: 'Details' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Search staff activity' }).fill(target.id);
  const row = page.locator('table').getByRole('row').filter({ hasText: reason });
  await expect(row, 'the approval this test performed must appear in the log the page renders').toBeVisible();
  await expect(row).toContainText('pending');
  await expect(row).toContainText('approved');
  await expect(row).toContainText('property');
});

test('the Details column, and the metadata behind it, are administrator-only', async ({ page, login }) => {
  await approveOnePendingListing();
  const manager = await fetch(`${API}/admin/staff-activity?size=100`, { headers: await authHeaders(ACTORS.manager) });
  expect(manager.status).toBe(200);
  for (const entry of (await manager.json()).content) expect(entry.metadata ?? {}, 'a manager must not receive audit metadata').toEqual({});

  const admin = await fetch(`${API}/admin/staff-activity?size=100`, { headers: await authHeaders(ACTORS.admin) });
  expect(admin.status).toBe(200);
  expect((await admin.json()).content.some((e) => Object.keys(e.metadata || {}).length > 0), 'an admin must receive audit metadata').toBe(true);

  await login.asManager();
  await page.goto('/admin/staff-activity?tab=log');
  await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Staff Member' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Details' })).toHaveCount(0);
});

test('staff cannot read the record that exists to hold them to account', async ({ page, login }) => {
  await login.asStaff();

  /* The audit log is administrator-only for this reason, and this page reads the same table. Two
     doors into the same rows with different locks is one lock. */
  await page.goto('/admin/staff-activity');
  await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toHaveCount(0);

  // The route's own permission, which the router would otherwise answer first.
  const refused = await fetch(`${API}/admin/audit-log`, { headers: await authHeaders(STAFF.rental) });
  expect(refused.status, 'a back-office staffer must not read the log that watches them').toBe(403);
  const allowed = await fetch(`${API}/admin/audit-log`, { headers: await authHeaders(ACTORS.admin) });
  expect(allowed.status, 'the same route must answer an admin, or the 403 above proves nothing').toBe(200);
});

test('All actors reads the full audit trail, customers and the system included, and exports it', async ({ page, login }) => {
  const trail = await fetch(`${API}/admin/audit-log?size=100`, { headers: await authHeaders(ACTORS.admin) });
  expect(trail.status).toBe(200);
  const entries = (await trail.json()).content;
  expect(entries.length, 'the seed must hold audited actions for the trail to show').toBeGreaterThan(0);

  await login.asAdmin();
  await openActivity(page);
  await expect(page.getByRole('button', { name: 'Back-office', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Latest 100 audited actions by anyone/)).toHaveCount(0);

  await page.getByRole('button', { name: 'All actors', exact: true }).click();
  await expect(page.getByRole('button', { name: 'All actors', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Latest 100 audited actions by anyone, including customers and the system. Read-only.')).toBeVisible();
  for (const name of ['When', 'Actor', 'Action', 'Record', 'Details']) {
    await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  await expect(rows(page).first()).toBeVisible();
  await expect(page.getByText('No audited actions recorded yet.')).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csv = fs.readFileSync(await (await download).path(), 'utf8').trim().split(/\r?\n/);
  expect(csv[0]).toContain('Actor');
  expect(csv[0]).toContain('Role');
  expect(csv.length, 'the export is every row the trail loaded').toBeGreaterThanOrEqual(entries.length + 1);

  await page.getByRole('button', { name: 'Back-office', exact: true }).click();
  await expect(page.getByText(/Latest 100 audited actions by anyone/)).toHaveCount(0);
  await expect(total(page)).toBeVisible();
});

test('a manager is not offered All actors', async ({ page, login }) => {
  await login.asManager();
  await openActivity(page);
  await expect(page.getByRole('button', { name: 'All actors' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back-office' })).toHaveCount(0);
});
/* A disabled module must say so and offer the way back, not render a blank pane that looks like a broken fetch.
   `AdminFlagsContext` reads the flag from `GET /admin/settings`, so the switch must be flipped there. */
test('a disabled module explains itself instead of rendering nothing', async ({ page, login }) => {
  const flag = { adminFlags: { staffActivity: { enabled: false } } };

  /* `PUT` merges, so this patch touches one key; `try/finally` restores it even if an assertion throws and would
     otherwise take the other tests down on the next run. */
  const res = await fetch(`${API}/admin/settings`, {
    method: 'PUT', headers: await authHeaders(ACTORS.admin), body: JSON.stringify(flag),
  });
  expect(res.status, 'could not disable the module through the settings route').toBe(200);

  try {
    await login.asAdmin();
    await page.goto('/admin/staff-activity');

    await expect(page.getByText('Team Activity module is disabled.')).toBeVisible();
    /* And the way out. A dead end here means an administrator who has to be told, by somebody else,
       which of forty switches to look for. */
    await expect(page.getByRole('link', { name: /Enable in Settings/i })).toBeVisible();

    /* Control against a page that failed to load: the feed's table and KPI must be absent, not merely un-found. */
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

  /* Prove the re-enable through the screen: `AdminFlagsContext` reads a different path than the API response. */
  await page.goto('/admin/staff-activity');
  await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toBeVisible();
});
