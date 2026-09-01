/**
 * The admin Service Requests desk works real tickets.
 *
 * ## What this replaces
 *
 * `AdminServices` used to read `listTickets()` from `lib/mockApi.js` and write back with
 * `updateTicket(id, { status: 'done' })`. Two things were wrong with that at once. The rows were
 * `db.json` fixtures, so an admin routing and resolving requests on this screen was moving nothing
 * any customer had sent and nothing any desk would see. And the four words the screen used —
 * `new`, `in_progress`, `done`, `cancelled` — are not `TicketStatuses`: the server has five, two of
 * which (`waiting`, `closed`) the old console could not express, and `cancelled` it has never had.
 * A rename would not have been enough; those words are the request body.
 *
 * The page now reads `GET /tickets` and writes through `PATCH /tickets/{id}` and
 * `POST /tickets/{id}/notes`. This spec asserts the round trip from outside the browser: what the
 * console does is visible to the API, and what the API holds is what the console shows.
 *
 * ## Why it raises its own ticket first
 *
 * The e2e database seeds zero tickets, and the desks are shared with other live specs. So this
 * creates exactly one ticket with a run-stamped subject, works that one, and asserts against the
 * API by id. No count is taken as a fact about the board.
 *
 * ## Why assignment is asserted through the API rather than the table
 *
 * The console shows `assignee` — a name the server resolved. The thing that could regress is that
 * the console sends an **id**: it used to send the display name, which meant two colleagues with
 * the same first name were the same person and a rename orphaned every ticket they held (S42).
 * Reading the row back and comparing the resolved name to the staff account this spec picked is
 * what proves the id made the trip.
 *
 * ## Why the ticket is found by its subject rather than by its service
 *
 * `TicketCreate` has no `service` component: naming the service line is an ops annotation, because
 * a client that could set its own would be writing the pipeline report. So every ticket a customer
 * raises has `service` null and its words in `subject`. The console's primary column and its search
 * both fall back accordingly — a board that showed a blank name for exactly the enquiries that came
 * from outside was the first thing this spec caught.
 *
 * Fixtures: `ACTORS.tenant` raises the ticket, `ACTORS.admin` works it, `STAFF.packers` is the
 * colleague it gets assigned to. All seeded.
 */
import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders, signIn } from '../helpers/liveAuth.js';
import { ACTORS, STAFF } from '../fixtures/live.js';
import { appReady } from '../helpers/app.js';

/** The desk this spec works. `packers` is in `tickets_team_check` and has a seeded staff account. */
const TEAM = 'packers';

/**
 * A subject nothing else can collide with. The board is append-only and shared, so every locator
 * below is scoped by this string rather than by position — `.first()` on a shared queue is a race
 * with whatever the previous spec left behind.
 */
const stamp = () => `E2E admin desk ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

/** Raise one ticket as a customer and hand back its id and subject. */
async function raiseTicket(request, subject) {
  const headers = await authHeaders(ACTORS.tenant);
  const res = await request.post(`${API}/tickets`, {
    headers,
    data: { team: TEAM, subject, body: 'Two-bedroom move, ground floor to third floor.' },
  });
  expect(res.status(), 'a signed-in customer may raise a ticket').toBe(201);
  const dto = await res.json();
  expect(dto.id, 'the server returns the id the console will act on').toBeTruthy();
  return dto.id;
}

/** Read one ticket back off the desk as staff, by id. */
async function readTicket(request, id) {
  const headers = await authHeaders(STAFF.packers);
  const res = await request.get(`${API}/tickets?team=${TEAM}&size=100`, { headers });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return (body?.content || []).find((t) => t.id === id) || null;
}

/** The themed dropdown is not a native `<select>` — `Select.jsx` renders `pn-dropdown`. */
const pick = async (page, ariaLabel, option) => {
  await page.getByLabel(ariaLabel, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

test.describe('admin service requests desk', () => {
  test('Start moves a real ticket to in-progress and assigns it to the desk', async ({ page, request }) => {
    const subject = stamp();
    const id = await raiseTicket(request, subject);

    const raised = await readTicket(request, id);
    expect(raised, 'the ticket the console is about to work exists on the desk').not.toBeNull();
    expect(raised.status, 'a newly raised ticket is open, not "new"').toBe('open');

    await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
    await page.goto('/admin/services');
    await appReady(page);

    await expect(page.getByRole('heading', { name: 'Service Requests' })).toBeVisible();

    /* Narrow to this ticket by its stamped subject rather than by status. The search box reads
       `service`, which for a raised ticket is the subject. */
    await page.getByPlaceholder('Search id, customer, detail…').fill(subject);
    const row = page.getByRole('row').filter({ hasText: subject });
    await expect(row).toHaveCount(1);

    await row.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('alert')).toContainText('Marked in progress');

    /* The assertion that matters is on the server, not the pixel. `in-progress` is the word
       `TicketStatuses` uses; the old console would have sent `in_progress` and been refused. */
    const after = await readTicket(request, id);
    expect(after.status).toBe('in-progress');
    /* Start also claims the ticket for the first active colleague on that desk, so an operator
       never has to remember to do it separately. Unassigned in-progress work is how a desk loses
       a ticket without anyone noticing. */
    expect(after.assignee, 'starting a request also gives it an owner').toBeTruthy();
  });

  test('Resolve moves it again, and the note append is additive', async ({ page, request }) => {
    const subject = stamp();
    const id = await raiseTicket(request, subject);

    /* Put a note on it as the desk first, so the console's own note has something to fail to
       overwrite. The old board sent the whole `notes` array back on every save, which discarded
       whatever a colleague had added in between. */
    const deskHeaders = await authHeaders(STAFF.packers);
    const first = await request.post(`${API}/tickets/${id}/notes`, {
      headers: deskHeaders,
      data: { body: 'Called the customer, no answer.' },
    });
    expect(first.status()).toBe(201);

    await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
    await page.goto('/admin/services');
    await appReady(page);

    await page.getByPlaceholder('Search id, customer, detail…').fill(subject);
    const row = page.getByRole('row').filter({ hasText: subject });
    await expect(row).toHaveCount(1);

    await row.getByRole('button', { name: 'Open' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    /* Hand it to a named colleague. The value the console sends is a user id; the server resolves
       the display name, and that resolution is what the assertion below checks. */
    const colleague = await apiLogin(STAFF.packers);
    await pick(page, 'Assign to', colleague.user.name);
    await pick(page, 'Status', 'Resolved');
    await dialog.getByPlaceholder('Add an internal note…').fill('Quote sent, customer accepted.');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('alert')).toContainText('Request updated');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const after = await readTicket(request, id);
    expect(after.status).toBe('resolved');
    expect(after.assignee, 'the assignee id made the trip and resolved to a real colleague')
      .toBe(colleague.user.name);
    /* Two notes, not one. The desk's note survived the console's save. */
    const bodies = (after.notes || []).map((n) => n.text || n.body);
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    expect(bodies.some((b) => String(b).includes('no answer'))).toBe(true);
    expect(bodies.some((b) => String(b).includes('customer accepted'))).toBe(true);
  });

  test('the status filter speaks the server vocabulary', async ({ page }) => {
    await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
    await page.goto('/admin/services');
    await appReady(page);

    await page.getByLabel('Filter by status', { exact: true }).click();

    /* The five words `TicketStatuses` has, and none of the four the mock store invented. A filter
       offering "Done" would send `done` and be refused by a 400 the operator never sees. */
    for (const label of ['Open', 'In Progress', 'Waiting', 'Resolved', 'Closed']) {
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
    for (const gone of ['New', 'Cancelled']) {
      await expect(page.getByRole('option', { name: gone, exact: true })).toHaveCount(0);
    }
  });
});
