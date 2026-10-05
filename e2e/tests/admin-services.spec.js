/** Home Loans desk (`/admin/home-loans`) against the live API; the e2e DB seeds no tickets and desks are shared,
 * so each test raises its own run-stamped ticket and asserts by id. */
import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders, signIn } from '../helpers/liveAuth.js';
import { ACTORS, STAFF } from '../fixtures/live.js';
import { appReady } from '../helpers/app.js';

/** The desk this spec works: the ticket console lives on the Home Loans page. */
const TEAM = 'loans';

/** A run-stamped subject: the board is shared and append-only, so locators are scoped by it, not by position. */
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
  const headers = await authHeaders(STAFF.loans);
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
    await page.goto('/admin/home-loans');
    await appReady(page);

    await expect(page.getByRole('heading', { name: 'Home Loans', exact: true })).toBeVisible();

    /* Narrow to this ticket by its stamped subject rather than by status. The search box reads
       `service`, which for a raised ticket is the subject. */
    await page.getByPlaceholder('Search id, customer, detail…').fill(subject);
    const row = page.getByRole('row').filter({ hasText: subject });
    await expect(row).toHaveCount(1);

    await row.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('alert')).toContainText('Marked in progress');

    /* Assert on the server: `TicketStatuses` spells it `in-progress`, and a UI-only check would miss a wrong status word. */
    const after = await readTicket(request, id);
    expect(after.status).toBe('in-progress');
    /* Start also claims the ticket for the first active colleague on the desk, so in-progress work is never left unassigned. */
    expect(after.assignee, 'starting a request also gives it an owner').toBeTruthy();
  });

  test('Resolve moves it again, and the note append is additive', async ({ page, request }) => {
    const subject = stamp();
    const id = await raiseTicket(request, subject);

    /* Seed a desk note first: proves the console appends to `notes` instead of overwriting a colleague's. */
    const deskHeaders = await authHeaders(STAFF.loans);
    const first = await request.post(`${API}/tickets/${id}/notes`, {
      headers: deskHeaders,
      data: { body: 'Called the customer, no answer.' },
    });
    expect(first.status()).toBe(201);

    await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
    await page.goto('/admin/home-loans');
    await appReady(page);

    await page.getByPlaceholder('Search id, customer, detail…').fill(subject);
    const row = page.getByRole('row').filter({ hasText: subject });
    await expect(row).toHaveCount(1);

    await row.getByRole('button', { name: 'Open' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    /* Hand it to a named colleague. The value the console sends is a user id; the server resolves
       the display name, and that resolution is what the assertion below checks. */
    const colleague = await apiLogin(STAFF.loans);
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
    await page.goto('/admin/home-loans');
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

  test('Assign to offers only the colleagues on that desk', async ({ page, request }) => {
    const subject = stamp();
    await raiseTicket(request, subject);

    /* Both colleagues are signed into, since a successful login proves each is active and the negative below is then only about the team filter. */
    const onDesk = await apiLogin(STAFF.loans);
    const elsewhere = await apiLogin(STAFF.packers);

    await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
    await page.goto('/admin/home-loans');
    await appReady(page);

    await page.getByPlaceholder('Search id, customer, detail…').fill(subject);
    const row = page.getByRole('row').filter({ hasText: subject });
    await expect(row).toHaveCount(1);

    await expect(page.getByRole('columnheader', { name: 'Desk' })).toHaveCount(0);
    await expect(page.getByLabel('Filter by desk', { exact: true })).toHaveCount(0);

    await row.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Assign to', { exact: true }).click();
    await expect(page.getByRole('option', { name: onDesk.user.name, exact: true })).toBeVisible();
    /* The desk is the entire filter: the server does not check an assignee belongs to the ticket's team, so this dropdown is the only enforcement. */
    await expect(page.getByRole('option', { name: elsewhere.user.name, exact: true })).toHaveCount(0);
  });

  /* A staffer without the loans desk can read `GET /tickets` but is sent to `/staff` from `/admin/home-loans`;
     her 200 anchors the redirect and the buyer's 403 as claims about the console. */
  test('the Home Loans desk is closed at the router to anyone without the desk — narrower than the API it reads — and a buyer is refused both', async ({ page, request }) => {
    await page.goto('/admin/home-loans');
    await expect(page).toHaveURL(/\/staff-login/);

    await signIn(page, ACTORS.buyer);
    await page.goto('/admin/home-loans');
    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'Home Loans', exact: true })).toHaveCount(0);

    /* The adversarial identity: a working back-office account, sent back to her own portal. */
    await signIn(page, STAFF.packers, { screen: 'staff' });
    await page.goto('/admin/home-loans');
    await expect(page).toHaveURL(/\/staff$/);
    await expect(page.getByRole('heading', { name: 'Home Loans', exact: true })).toHaveCount(0);

    /* `/admin/services` is not a route: an admin lands on the portal home. */
    await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
    await page.goto('/admin/services');
    await expect(page).toHaveURL(/\/admin$/);
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
