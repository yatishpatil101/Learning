/**
 * The Settings audit tab, against the server's append-only trail.
 *
 * ## Why this file exists, when a sibling spec said it never would
 *
 * `admin/live-settings-console.spec.js` carries a section headed "The audit-log test did not come
 * across, and will not". Its reasoning was right and is quoted here so that the reversal is
 * legible rather than silent:
 *
 *   > That tab is fed by `listAudit` / `clearAudit` from `frontend/src/lib/mockApi.js`: a log kept
 *   > in the browser, written by whichever tab happened to make the change, and invisible to every
 *   > other operator and to the server. […] a live spec pointed at it would sign in against the
 *   > real API, load the real page, and then assert something about `localStorage` in a fresh
 *   > context. It would pass on a server with no audit trail at all, pass with the trail on fire,
 *   > and pass with the endpoint deleted.
 *
 * Every word of that was true of the screen it described. The screen has changed: `AdminSettings`
 * now reads `GET /admin/audit-log` through `services/auditService.js`, so the three false passes it
 * names are exactly the three failures this file is built to produce. The condition the decision
 * set — Decision 39, "it closes only as a server-backed history surface" — is met, and this spec is
 * what meeting it looks like.
 *
 * ## The seed has no audit rows, so the spec makes one
 *
 * `GET /admin/audit-log` on a freshly reset `draazy_e2e` returns `totalElements: 0`. That is not
 * a gap to work around; it is the better test. A spec that read a seeded row would prove the page
 * can render a fixture. This one performs a real privileged action through the API — approving a
 * pending listing — and then asserts the screen shows the row the *server* chose to write about it,
 * with the entity id the action named. Nothing in the browser composes that row, so the assertion
 * cannot be satisfied by anything except the trail working end to end.
 *
 * The action is issued over HTTP rather than clicked through the moderation console on purpose: the
 * claim under test is "this tab shows what the server recorded", and driving the write through a
 * second admin screen would put that screen's correctness inside this test's failure surface.
 *
 * ## The fallback-to-mock trap this file is written against
 *
 * `services/config.js` falls back to the mock provider with a `console.warn`, not an error. So an
 * `audit` domain missing from `VITE_API_DOMAINS` would render a plausible, populated audit table
 * off `db.json` and pass any test that merely asserted "rows are visible". The two shapes are
 * distinguishable and the assertions below turn on the difference: the wire's `action` is a dotted
 * event name (`property.status`), the mock's is a UI section label (`Enquiries`, `Site settings`),
 * and the wire's actor column is a UUID prefix where the mock's is a display name. Asserting the
 * dotted action of an event *this test caused* fails on a mock fallback, because the mock store has
 * no idea the PATCH happened.
 */

import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** Every test starts signed in as admin on a known page; the fixture handles the OTP dance. */
async function openAudit(page, login) {
  await login.asAdmin();
  await page.goto('/admin/settings?tab=audit');
}

/**
 * Approve one pending listing over the API and return its id.
 *
 * `PropertyModerationController.setStatus` is `@PreAuthorize(PROPERTIES_WRITE)` and
 * `PropertyModerationService` hands `AuditService` a `property.status` row naming the caller, the
 * listing and the transition. The reason string is echoed into `metadata.reason`, which is what
 * makes the row identifiable below without depending on which listing the queue happened to offer.
 */
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

  /* The row itself. `property.status` is the server's vocabulary: the mock provider's `action`
     values are UI section labels, so this locator finds nothing at all if the `audit` domain has
     quietly fallen back to mocks. Scoped to a row containing the listing's id prefix so that a
     shared database with other sessions' approvals in it cannot satisfy this by accident — the
     screen must show the row for *this* action. */
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

  /* Decision 39, 2026-08-22: "keep the audit tab, read-only. **No clear/reset controls** are part
     of Phase 5". The control it forbade shipped anyway and survived until now: a "Clear" button
     that emptied a `localStorage` array, told the operator "Audit log cleared", and left the actual
     record untouched. On a live build it could only mislead — either the reader believed the log
     was gone when it was not, or they believed a compliance record was theirs to erase.

     The trail is append-only by construction (`AuditService` is the sole writer, `AuditLog` marks
     every column `updatable = false`, and there is no write, update or delete route), so there is
     no honest server call this button could have been repointed at. It had to go, and this
     assertion is what stops it coming back. */
  await expect(page.getByRole('button', { name: /^Clear/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Delete|Reset|Wipe/i })).toHaveCount(0);
});

test('a staff token is refused the trail outright', async ({ page, login }) => {
  /* Asserted at the API rather than through the UI, because through the UI it is unfalsifiable:
     `live-rbac.spec.js` already proves a staffer never reaches `/admin` at all, so a staff session
     pointed at this page would be bounced by the router and the audit route's own permission would
     never be exercised. The 403 below is the claim `Routes.java` actually makes about this route —
     "Deliberately not staff-visible: the log exists to hold privileged users to account, and a
     reader who can also act is a reader with a motive to check whether they were noticed."

     Paired with the admin 200 in the same test, because a 403 on its own is satisfied by a route
     that does not exist, a typo in the path, and a token that failed to mint. */
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
