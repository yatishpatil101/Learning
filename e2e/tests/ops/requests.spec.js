import { test, expect } from '../../fixtures/base.js';

/* Ops service queues (back-office). Staff sign in via the /staff-login quick
   buttons, which drop them on their team home under RoleRoute roles=['staff','admin'].
   These specs assert the REAL guard + queue behaviour:
     - /ops (OpsDashboard) and /ops/requests (OpsQueue) render for any staff.
     - TeamRoute: a Rental staffer opens /ops/rent-agreement but is bounced from
       /ops/legal to /ops?denied=legal (RouteGuards.jsx TeamRoute).
     - RoleRoute: an unauthenticated visitor is redirected to /staff-login.
     - A queue action (claim/resolve) updates a ticket and toasts. */

test('Rental staff lands on ops and sees the team dashboard', async ({ page, login, consoleErrors }) => {
  await login.asStaff('Rental');            // quick login → /ops/rent-agreement
  await expect(page).toHaveURL(/\/ops/);

  await page.goto('/ops');
  await expect(page.getByRole('heading', { name: 'My Dashboard' })).toBeVisible();
  // Team-scoped subtitle proves the staffer is scoped to their own team.
  await expect(page.getByText('Team: rental')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('the all-requests ticket queue renders with its status buckets', async ({ page, login, consoleErrors }) => {
  await login.asStaff('Rental');
  await page.goto('/ops/requests');

  await expect(page.getByRole('heading', { name: 'Service requests' })).toBeVisible();
  // Status-tile filters (All / New / In progress / Done) and the search box.
  await expect(page.getByRole('button', { name: /In progress/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Done/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Search customer/i)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('Rental staff can open their own team workflow queue', async ({ page, login }) => {
  await login.asStaff('Rental');
  await page.goto('/ops/rent-agreement');

  // OpsServiceQueue type="rental" → SVC_CONFIG.rental.title.
  await expect(page.getByRole('heading', { name: 'Rent Agreement queue' })).toBeVisible();
});

test('TeamRoute blocks a Rental staffer from another team’s queue', async ({ page, login }) => {
  await login.asStaff('Rental');
  await page.goto('/ops/legal');

  // TeamRoute redirects to /ops?denied=legal; the dashboard shows the denied banner.
  await expect(page).toHaveURL(/\/ops\?denied=legal/);
  // Scope to the denied banner (role="alert") — the team name also appears in the nav.
  const banner = page.getByRole('alert').filter({ hasText: /don't have access/i });
  await expect(banner).toBeVisible();
  await expect(banner.getByText('Property & Legal')).toBeVisible();
  // The blocked team's own queue heading must NOT have rendered.
  await expect(page.getByRole('heading', { name: 'Property & Legal', exact: true })).toHaveCount(0);
});

test('an unauthenticated visitor is redirected away from /ops to staff-login', async ({ page }) => {
  await page.goto('/ops');

  // RoleRoute → Navigate to /staff-login?next=/ops (no ops content rendered).
  await expect(page).toHaveURL(/\/staff-login/);
  await expect(page.getByRole('button', { name: 'Rental', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My Dashboard' })).toHaveCount(0);
});

test('a queue action claims/resolves a ticket and confirms with a toast', async ({ page, login }) => {
  await login.asStaff('Rental');
  await page.goto('/ops/requests');
  await expect(page.getByRole('heading', { name: 'Service requests' })).toBeVisible();

  // Row actions are status-aware: `new` → Claim, `in_progress` → Resolve.
  const action = page.getByRole('button', { name: /^(Claim|Resolve)$/ }).first();
  await expect(action).toBeVisible({ timeout: 10000 });
  await action.click();

  // claim → "Assigned to you"; resolve → "Ticket updated".
  await expect(page.getByText(/Assigned to you|Ticket updated/i).first()).toBeVisible();
});

test('the queue paginates instead of rendering the whole backlog', async ({ page, login }) => {
  await login.asStaff('Rental');
  await page.goto('/ops/requests');
  await expect(page.getByRole('heading', { name: 'Service requests' })).toBeVisible();

  /* This queue was the only Table in the app without `pageSize`, so it rendered
     every ticket at once — 1,857 DOM nodes across 34 rows, growing with the
     backlog, on a page field-ops staff open from a phone. AdminSupport renders
     the same listTickets data with pageSize={10}; this brings the queue in line.
     Measured 1,857 -> 693 nodes.

     Asserted as a bound rather than "exactly 10": the seed backlog can change,
     and what matters is that the page shows a window, not the whole table. */
  const rows = page.locator('tbody tr');
  const count = await rows.count();
  expect(count, 'a page of tickets, not the whole backlog').toBeGreaterThan(0);
  expect(count, 'the queue must not render every ticket at once').toBeLessThanOrEqual(10);

  // The pager states the window honestly, so "10 tickets" is never mistaken for
  // "10 tickets exist".
  await expect(page.getByText(/Showing\s+1.*of\s+\d+\s+tickets/i)).toBeVisible();
});
