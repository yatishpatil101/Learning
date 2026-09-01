import { test, expect } from '../../fixtures/base.js';

/* Ops back-office, mock mode — what is left here after the board went live.
 *
 * `/ops` and `/ops/requests` now read `GET /tickets` through `services/ticketService.js` and there
 * is no mock provider behind it, deliberately: `lib/mockApi.js`'s ticket store knows three statuses
 * where the server knows five, assigns by display name where the server assigns by user id, and
 * hands back the whole board where the server pages. D184 already refused that translation table
 * for the drafting desk. So in mock mode both screens say what they cannot do, and the real board
 * behaviour is proven in `live-ops-board.spec.js`.
 *
 * What still belongs in mock mode is everything that is *not* about ticket data: the role guard,
 * and the five retired per-team desks now redirecting into the one drafting desk. Those are
 * routing facts, and routing does not need a backend to be true. */

test('an unauthenticated visitor is redirected away from /ops to staff-login', async ({ page }) => {
  await page.goto('/ops');

  // RoleRoute → Navigate to /staff-login?next=/ops (no ops content rendered).
  await expect(page).toHaveURL(/\/staff-login/);
  await expect(page.getByRole('button', { name: 'Rental', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My Dashboard' })).toHaveCount(0);
});

test('the dashboard refuses to show zeros it cannot stand behind', async ({ page, login, consoleErrors }) => {
  await login.asStaff('Rental');
  await page.goto('/ops');

  await expect(page.getByRole('heading', { name: 'My Dashboard' })).toBeVisible();
  await expect(page.getByText('Team: rental')).toBeVisible();

  /* The tiles count real tickets. Rendering "0 open" when the queue is merely unreachable would
     tell a staffer the day is clear when nobody has looked — which is the exact defect that
     retired the five per-team desks, so it is asserted rather than left to good intentions. */
  await expect(page.getByText(/needs the live API/i)).toBeVisible();
  await expect(page.getByText(/tell you the day is clear when nobody has actually looked/i)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('the ticket board says why it is shut rather than showing an empty queue', async ({ page, login, consoleErrors }) => {
  await login.asStaff('Rental');
  await page.goto('/ops/requests');

  await expect(page.getByRole('heading', { name: 'Service requests' })).toBeVisible();
  await expect(page.getByText(/This board needs the live API/i)).toBeVisible();
  await expect(page.getByText(/cannot speak its status vocabulary/i)).toBeVisible();

  // No table, no filters, no actions — a shut board offers nothing to act on.
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByPlaceholder(/Search customer/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Claim|Resolve)$/ })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test('the retired Rent Agreement desk redirects into the drafting desk, pre-filtered', async ({ page, login }) => {
  await login.asStaff('Rental');
  await page.goto('/ops/rent-agreement');

  // The bookmark still works; it just lands somewhere else now.
  await expect(page).toHaveURL(/\/ops\/drafting-desk\?type=rental/);
  await expect(page.getByRole('heading', { name: 'Drafting desk' })).toBeVisible();
  // Mock mode: the desk is seam-only, so it names the reason rather than showing an empty table.
  await expect(page.getByText(/needs the live API/i)).toBeVisible();
});

test('another team’s retired desk still redirects, guard or no guard', async ({ page, login }) => {
  await login.asStaff('Rental');
  // `TeamRoute` used to bounce this to /ops?denied=legal. It is gone: the server, not the
  // browser, decides what a staff caller may read (D44, `ServiceDeskAuthority.deskFilterFor`),
  // so the guard was never the thing holding the line — it only chose the error message.
  await page.goto('/ops/legal');
  await expect(page).toHaveURL(/\/ops\/drafting-desk\?type=legal/);

  /* What replaces the bounce on screen — a desk picker offering a staffer their own desk and
     nothing else — is asserted in `live-drafting-desk.spec.js`, not here: the filters render
     only once the queue is live, and in mock mode this screen is the offline panel. */
  await expect(page.getByText(/needs the live API/i)).toBeVisible();
});
