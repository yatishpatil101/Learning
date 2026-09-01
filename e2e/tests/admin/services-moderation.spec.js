import { test, expect } from '../../fixtures/base.js';

/**
 * Admin › Service Requests — /admin/services, in a build with no ticket API.
 *
 * What this file used to be, and why it is a third of the size now.
 * -----------------------------------------------------------------
 * It asserted "34 of 34 requests", nine `new` leads, a Start that moved one to
 * `in_progress` and a Resolve that moved one to `done`. Every one of those numbers came
 * from `frontend/src/data/db.json`, and every one of those words came from the mock
 * store's own status vocabulary — `TicketStatuses` on the server has never had `new`,
 * `in_progress` or `done`. The spec was green and described a desk nobody worked.
 *
 * The page now reads `GET /tickets`, and `ticket` is a live-only domain: there is no mock
 * provider for it, deliberately (D184). So in this build the console has nothing to show
 * and says so. That sentence is the thing worth testing here — an empty table would read
 * as "no customer has asked for anything", which is a different and much worse claim.
 *
 * The workflow — Start, Resolve, assign a named colleague, the note append — moved to
 * `e2e/tests/live-admin-services.spec.js`, where the tickets are real.
 *
 * The two route-guard tests went the same way, and were widened on arrival. They said that an
 * anonymous visitor and a buyer are both bounced to staff-login. Both are true and neither is
 * interesting: a buyer is not a back-office identity at all. The live file names the identity that
 * is — a **staffer**, who holds a real back-office session and whom `GET /tickets` answers `200` —
 * and proves she is turned away from this console anyway, because it is `roles={['admin']}` while
 * the API behind it is ops-wide. That asymmetry cannot be observed in a build with no API.
 *
 * Source: frontend/src/pages/admin/AdminServices.jsx, frontend/src/lib/data/tickets.js.
 * Fixtures: none — the desk is empty by construction in this configuration.
 *
 * ## Verdict: HONOURED (1 test)
 *
 * The offline panel is never rendered live because the ticket API is always available there. Only
 * mock mode — where `ticket` has no provider — can observe what the desk says when it is shut.
 */

test('with no ticket API the desk says so rather than showing an empty queue', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/services');

  await expect(page.getByText(/served by the API, which is not enabled/)).toBeVisible();

  // Not a board with nothing on it: the table, the KPI tiles and the filters are all absent,
  // so there is no number on screen for an operator to read as a fact about the desk.
  await expect(page.getByText('Total requests')).toHaveCount(0);
  await expect(page.getByPlaceholder('Search id, customer, detail…')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});
