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
 * What still belongs in mock mode is the one thing that is *not* about ticket data and *not* about
 * routing: the offline panel itself. A screen that names why it is shut can only be checked where
 * it is shut, and it is never shut live.
 *
 * The routing facts that used to sit here — the `/ops` role guard, and the retired per-team desks
 * redirecting into the one drafting desk — moved to `live-drafting-desk.spec.js` and were widened
 * on the way. Mock mode could say the URL changed; it could not say the desk *honoured* the filter
 * the URL carries, which is the half a mistyped alias would break. The `/ops/legal` case was not
 * ported at all: `live-drafting-desk.spec.js`'s 'a staffer is offered their own desk and no other'
 * already lands that redirect and then shows the picker refusing to offer anyone else's desk. */

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
