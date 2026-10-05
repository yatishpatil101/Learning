// The dotted action proves the screen shows the server-written audit row.
import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';
import { approveListingWithFetch } from '../../helpers/moderation.js';

async function openAudit(page) {
  await page.goto('/admin/settings?tab=audit');
}

// `metadata.reason` makes the row identifiable without depending on queue order.
async function approveAPendingListing(headers, reason) {
  const queue = await fetch(`${API}/admin/properties?status=pending&size=1`, { headers });
  expect(queue.status, 'the moderation queue must be readable before anything can be approved').toBe(200);
  const body = await queue.json();
  const target = (body.content || [])[0];
  expect(target, 'the e2e seed must contain at least one pending listing for this spec to act on').toBeTruthy();

  const patch = await approveListingWithFetch(target.id, headers, { reason });
  expect(patch.status, 'the approval itself must succeed, or the trail has nothing to have recorded').toBe(200);
  return target.id;
}

test('the audit tab shows the server-written row, offers no way to write to the trail, and is closed to staff', async ({ page, login }) => {
  await test.step('the tab shows the row the server wrote for an action this test performed', async () => {
    const headers = await authHeaders(ACTORS.admin);
    const reason = `audit-spec-${Date.now()}`;
    const listingId = await approveAPendingListing(headers, reason);

    // And the page an admin does reach renders.
    await login.asAdmin();
    await openAudit(page);

    // The positive anchor, before anything else.
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    // An absence-only assertion on a page that never rendered is the cheapest false green there is.
    await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();

    // `property.status` is server vocabulary, so mocks cannot satisfy this locator.
    const shortListingId = listingId.slice(0, 8);
    const row = page.locator('tr', { hasText: shortListingId }).filter({ hasText: 'property.status' });
    await expect(row, 'the approval this test performed must appear in the trail the page renders').toBeVisible();

    // The wire carries structured metadata; a page still reading `detail` would go blank.
    await expect(row).toContainText('pending');
    await expect(row).toContainText('approved');
    await expect(row).toContainText(reason);

    const me = await (await fetch(`${API}/auth/me`, { headers })).json();
    expect(me.name, 'the seeded admin must have a name for the column to show').toBeTruthy();
    await expect(row).toContainText(me.name);
  });
  await test.step('nothing on the tab can write to the trail, and the Clear button is gone', async () => {
    await openAudit(page);

    await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export CSV/ })).toBeVisible();

    // Audit is append-only; a clear button could only lie about erased compliance records.
    await expect(page.getByRole('button', { name: /^Clear/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Delete|Reset|Wipe/i })).toHaveCount(0);
  });
  await test.step('a staff token is refused the trail outright', async () => {
    // API-level assertion reaches the route permission that the router would hide.
    const staffHeaders = await authHeaders(STAFF.rental);
    const refused = await fetch(`${API}/admin/audit-log`, { headers: staffHeaders });
    expect(refused.status, 'a back-office staffer must not be able to read the log that watches them').toBe(403);

    const adminHeaders = await authHeaders(ACTORS.admin);
    const allowed = await fetch(`${API}/admin/audit-log`, { headers: adminHeaders });
    expect(allowed.status, 'the same route must answer an admin, or the 403 above proves nothing').toBe(200);
  });
});
