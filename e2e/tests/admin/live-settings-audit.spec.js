/* The Settings audit tab. The spec causes a real privileged action over the API, then asserts the
   screen shows the row the *server* wrote — whose dotted `action` a mock fallback cannot produce. */

import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** Every test starts signed in as admin on a known page; the fixture handles the OTP dance. */
async function openAudit(page, login) {
  await login.asAdmin();
  await page.goto('/admin/settings?tab=audit');
}

/* Approve one pending listing over the API and return its id. The reason string is echoed into
   `metadata.reason`, which is what makes the row identifiable without depending on which listing
   the queue happened to offer. */
async function approveAPendingListing(headers, reason) {
  const queue = await fetch(`${API}/admin/properties?status=pending&size=1`, { headers });
  expect(queue.status, 'the moderation queue must be readable before anything can be approved').toBe(200);
  const body = await queue.json();
  const target = (body.content || [])[0];
  expect(target, 'the e2e seed must contain at least one pending listing for this spec to act on').toBeTruthy();

  const patch = await fetch(`${API}/properties/${target.id}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'approved', reason }),
  });
  expect(patch.status, 'the approval itself must succeed, or the trail has nothing to have recorded').toBe(200);
  return target.id;
}

test('the tab shows the row the server wrote for an action this test performed', async ({ page, login }) => {
  const headers = await authHeaders(ACTORS.admin);
  const reason = `audit-spec-${Date.now()}`;
  const listingId = await approveAPendingListing(headers, reason);

  await openAudit(page, login);

  /* The positive anchor, before anything else. Deep-linked `?tab=audit` falls back to General on an
     unrecognised id, and an admin console that failed to load draws no headings at all — both of
     which would let the row assertions below fail for a reason that has nothing to do with the
     audit trail. Assert we are on the tab we think we are on first. */
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();

  /* `property.status` is the server's vocabulary, so this locator finds nothing if the `audit`
     domain has fallen back to mocks. Scoped to the listing's id prefix so a shared database with
     other sessions' approvals cannot satisfy it by accident. */
  const shortListingId = listingId.slice(0, 8);
  const row = page.locator('tr', { hasText: shortListingId }).filter({ hasText: 'property.status' });
  await expect(row, 'the approval this test performed must appear in the trail the page renders').toBeVisible();

  /* And the transition, rendered out of `metadata`. This is the half a naive repoint would have
     lost: the mock row carried a free-text `detail` sentence and the wire carries a structured
     object, so a page that kept reading `detail` would show a blank Details column and still pass
     every assertion above. */
  await expect(row).toContainText('pending');
  await expect(row).toContainText('approved');
  await expect(row).toContainText(reason);
});

test('nothing on the tab can write to the trail, and the Clear button is gone', async ({ page, login }) => {
  await openAudit(page, login);

  /* Positive anchor first — see the previous test. An absence-only assertion on a page that never
     rendered is the cheapest false green there is. */
  await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Export CSV/ })).toBeVisible();

  /* No clear/reset control: the trail is append-only by construction, so there is no honest server
     call such a button could make — it could only tell the operator a compliance record was gone,
     or was theirs to erase. This assertion is what stops one coming back. */
  await expect(page.getByRole('button', { name: /^Clear/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Delete|Reset|Wipe/i })).toHaveCount(0);
});

test('a staff token is refused the trail outright', async ({ page, login }) => {
  /* Asserted at the API because through the UI it is unfalsifiable: a staff session is bounced by
     the router before the audit route's permission is ever exercised. Paired with the admin 200,
     since a 403 alone is satisfied by a missing route, a typo, or a token that failed to mint. */
  const staffHeaders = await authHeaders(STAFF.rental);
  const refused = await fetch(`${API}/admin/audit-log`, { headers: staffHeaders });
  expect(refused.status, 'a back-office staffer must not be able to read the log that watches them').toBe(403);

  const adminHeaders = await authHeaders(ACTORS.admin);
  const allowed = await fetch(`${API}/admin/audit-log`, { headers: adminHeaders });
  expect(allowed.status, 'the same route must answer an admin, or the 403 above proves nothing').toBe(200);

  /* And the page an admin does reach renders. Keeps this test honest about the UI half of the
     claim without duplicating the row assertions above. */
  await openAudit(page, login);
  await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();
});
