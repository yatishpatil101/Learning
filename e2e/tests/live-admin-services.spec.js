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
 * ## Why the desk a ticket belongs to gets its own test
 *
 * `TEAM_LABEL` (`lib/data/tickets.js`) is the one piece of this screen's vocabulary with no server
 * representation at all. `tickets_team_check` stores the routing key — `loans` — and the customer
 * bought a named service — "Home Loans". A board that printed the key would be legible only to the
 * people who wrote the constraint. The same key is also the whole filter on the Assign-to list, so
 * handing a home-loan enquiry to the movers is not a mistake this screen lets an operator make.
 *
 * That pair used to be asserted in `tests/consumer/services/loans-team.spec.js`, against the mock
 * store. When that file's admin half was deleted in `fbbfd18` — the console it drove is live-only
 * now, and rendered an honest notice instead — the commit message said the assertions had moved
 * here. They had not. This is them.
 *
 * Fixtures: `ACTORS.tenant` raises the ticket, `ACTORS.admin` works it, `STAFF.packers` is the
 * colleague it gets assigned to, `STAFF.loans` is the colleague on the other desk. All seeded.
 */
import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders, signIn } from '../helpers/liveAuth.js';
import { ACTORS, STAFF } from '../fixtures/live.js';
import { appReady } from '../helpers/app.js';

/** The desk this spec works. `packers` is in `tickets_team_check` and has a seeded staff account. */
const TEAM = 'packers';

/**
 * A second desk, for the routing test.
 *
 * One is not enough. If every ticket in the fixture were `packers`, a board that ignored `team`
 * entirely and hard-coded one label would still look right — and an Assign-to list that offered
 * every colleague in the company would too.
 */
const OTHER_TEAM = 'loans';

/** What `TEAM_LABEL` turns {@link OTHER_TEAM} into. The customer-facing name of that service. */
const OTHER_TEAM_LABEL = 'Home Loans';

/**
 * A subject nothing else can collide with. The board is append-only and shared, so every locator
 * below is scoped by this string rather than by position — `.first()` on a shared queue is a race
 * with whatever the previous spec left behind.
 */
const stamp = () => `E2E admin desk ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

/** Raise one ticket as a customer and hand back its id and subject. */
async function raiseTicket(request, subject, team = TEAM) {
  const headers = await authHeaders(ACTORS.tenant);
  const res = await request.post(`${API}/tickets`, {
    headers,
    data: { team, subject, body: 'Two-bedroom move, ground floor to third floor.' },
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

/** The themed dropdown is not a native `<select>` — `Select.jsx` renders `dz-dropdown`. */
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

  test('a ticket carries its desk to the board, by name, and Assign to offers only that desk', async ({ page, request }) => {
    const subject = stamp();
    await raiseTicket(request, subject, OTHER_TEAM);

    /* Both colleagues are signed into rather than merely named. `STAFF.loans` is the one the
       dropdown must offer and `STAFF.packers` is the one it must not — and an absence assertion
       about a suspended account would pass for the wrong reason. A successful login is the proof
       that each is active, so the negative below can only be about the team filter. */
    const onDesk = await apiLogin(STAFF.loans);
    const elsewhere = await apiLogin(STAFF.packers);

    await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
    await page.goto('/admin/services');
    await appReady(page);

    await page.getByPlaceholder('Search id, customer, detail…').fill(subject);
    const row = page.getByRole('row').filter({ hasText: subject });
    await expect(row).toHaveCount(1);

    /* "Home Loans", not "loans". The wire value is a routing key; this is the service the customer
       thinks they bought. Exact, so a cell that merely contained the word would not satisfy it. */
    await expect(row.getByText(OTHER_TEAM_LABEL, { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Assign to', { exact: true }).click();
    await expect(page.getByRole('option', { name: onDesk.user.name, exact: true })).toBeVisible();
    /* The desk is the entire filter on this list. Narrowing it is what makes mis-routing
       unavailable rather than merely discouraged — there is no server-side check that an assignee
       belongs to the ticket's team, so this dropdown is the only thing enforcing it. */
    await expect(page.getByRole('option', { name: elsewhere.user.name, exact: true })).toHaveCount(0);
  });

  /*
   * The route guard, brought over from `admin/services-moderation.spec.js` when that file was cut
   * back to its one mock-only keeper — and widened, because the mock version could only name the
   * two identities that are obviously wrong.
   *
   * What it used to say was that a visitor with no session is bounced to staff-login, and that a
   * buyer is too. Both are true and neither is interesting: a buyer is not a back-office identity
   * at all, so a guard that let one through would be broken in a way somebody would notice on the
   * first day.
   *
   * The identity worth naming is a **staffer**. She holds a real back-office session, signs in on
   * the same `/staff-login` screen the admin uses, opens `/ops/drafting-desk` every day, and — as
   * the last two assertions below prove — the ticket API answers her `200`. She is exactly the
   * caller for whom "is anyone there?", "is this a back-office account?" and "may this account read
   * tickets?" all say yes. The admin console is nonetheless `roles={['admin']}`, so she is turned
   * away at the router.
   *
   * That makes the shape of this guard worth stating plainly, because it is the opposite of the one
   * on `/ops/drafting-desk`: there the router is permissive and the *API* narrows what you see, here
   * the API is ops-wide and the *router* is the narrower of the two. Asserting a 403 for the staffer
   * would therefore be asserting a rule that does not exist — and would fail today, against a
   * server that is behaving correctly.
   *
   * Every absence is anchored. The staffer's `200` is what turns "she cannot open the console" into
   * a statement about the console rather than about her account being broken; the admin's `200` is
   * what stops a `GET /tickets` that refused everybody from satisfying the buyer's `403`.
   *
   * Mutation-proved twice, each reddening one assertion and no other. Adding `staff` to the admin
   * `RoleRoute` in `App.jsx` reddens the staffer's redirect. The buyer's `403` needed *both* layers
   * broken to move, which is itself worth recording: relaxing `OPS_MAY_READ_TICKETS` to
   * `isAuthenticated()` on `TicketsController#list` is not enough on its own, because
   * `TicketService#list` independently refuses a non-admin caller with no desk. With the annotation
   * relaxed and that branch forced open, the assertion went red carrying the proof in its own
   * message — the buyer holding page 1 of 3 of the board, another customer's name and mobile on it.
   */
  test('the console is admin-only at the router — narrower than the API it reads — and a buyer is refused both', async ({ page, request }) => {
    await page.goto('/admin/services');
    await expect(page).toHaveURL(/\/staff-login/);

    await signIn(page, ACTORS.buyer);
    await page.goto('/admin/services');
    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'Service Requests' })).toHaveCount(0);

    /* The adversarial identity: a working back-office account, refused the console anyway. */
    await signIn(page, STAFF.packers, { screen: 'staff' });
    await page.goto('/admin/services');
    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'Service Requests' })).toHaveCount(0);

    const board = async (mobile) => {
      const res = await request.get(`${API}/tickets?size=1`, { headers: await authHeaders(mobile) });
      return { status: res.status(), body: await res.text() };
    };

    /* A customer is refused the board outright — this one really is a 403, because `GET /tickets`
       is `hasAnyRole(STAFF, ADMIN) and tickets:read` and a buyer fails the first clause. */
    const asBuyer = await board(ACTORS.buyer);
    expect(asBuyer.status, asBuyer.body).toBe(403);

    /* ...while the staffer just turned away from the console reads it fine. Without this line the
       redirect above would be satisfied by a suspended account, and the guard would be unproved. */
    const asStaff = await board(STAFF.packers);
    expect(asStaff.status, asStaff.body).toBe(200);

    const asAdmin = await board(ACTORS.admin);
    expect(asAdmin.status, asAdmin.body).toBe(200);
  });
});
