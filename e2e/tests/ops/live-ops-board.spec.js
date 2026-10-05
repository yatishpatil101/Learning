import { expect, test } from '../../fixtures/live.js';
import { API, apiLogin } from '../../helpers/liveAuth.js';

/**
 * Home Loans ticket board against the live API — `/admin/home-loans` over `GET|PATCH /tickets`.
 *
 * The board used to read `lib/mockApi.js`. Converting it was not a wiring job: three of its words
 * were wrong rather than merely different. It knew three statuses where `TicketStatuses` knows five,
 * it assigned by typing a display **name** where `TicketUpdate` takes a user **id** (and 404s an id
 * that is not an ops user), and it read-modify-wrote the whole `notes` array where the server has a
 * dedicated append. So there is no mock provider and no translation table — D184's call, made again
 * for the same reason — and everything below is asserted against Postgres.
 *
 * **The suite mints its own tickets.** The seed ships none (`GET /tickets` is `totalElements=0` on a
 * fresh baseline), and `POST /tickets` carries no role guard on purpose: "a queue only privileged
 * people can write to collects nothing". So a customer raises the ticket, exactly as one would in
 * life, and the desk finds it — which also proves the two halves agree about what a ticket is.
 */

const CUSTOMER = { mobile: '9700000001', name: 'Rahul Mehta' };
const LOANS_STAFF = { mobile: '9812733640', name: 'Aarav Deshpande' };

const SUBJECT = 'Live board spec ticket';

/** Raise one ticket as the customer, over HTTP. Returns the created record. */
async function seedTicket({ team = 'loans', priority = 'high', detail } = {}) {
  const { accessToken } = await apiLogin(CUSTOMER.mobile);
  const res = await fetch(`${API}/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      subject: SUBJECT,
      team,
      priority,
      body: detail || 'Needs a callback about the agreement.',
    }),
  });
  if (!res.ok) throw new Error(`seedTicket: ${res.status} ${await res.text()}`);
  return res.json();
}

/** The row this file created, located by the customer's name rather than by a generated id. */
const ourRow = (page) => page.getByRole('row').filter({ hasText: CUSTOMER.name }).first();

/**
 * The status badge in that row.
 *
 * `exact` is load-bearing, not tidiness: every row also carries an **Open** action button, so a
 * substring match on "open" resolves to two elements and the assertion dies in strict mode. The
 * badge's DOM text is the server's own lowercase word — `Badge` capitalises it in CSS, so the eye
 * reads "Open" while the matcher reads "open" — which both disambiguates it and means these
 * assertions are checking the wire vocabulary rather than a label someone could translate.
 */
const statusOf = (page, status) => ourRow(page).getByText(status, { exact: true });

/** A count tile reads "<label><n>"; the label alone is the stable part. */
const tile = (page, label) => page.locator('.dz-card').filter({ hasText: new RegExp(`^${label}\\d`) });

const openDrawerFor = async (page) => {
  await ourRow(page).getByRole('button', { name: 'Open', exact: true }).click();
  return page.getByRole('dialog');
};

async function openBoard(page, login) {
  await login.asStaff('loans');
  await page.goto('/admin/home-loans');
  await expect(page.getByRole('heading', { name: 'Home Loans' })).toBeVisible();
  // If this fires, the board fell back to the offline panel and nothing below means anything.
  await expect(page.getByText(/needs the live API/i)).toHaveCount(0);
}

test.describe('Ops → ticket board (live)', () => {
  test.beforeEach(async () => {
    await seedTicket();
  });

  test('a ticket a customer raised turns up on the desk that owns it', async ({ page, login }) => {
    await openBoard(page, login);

    const row = ourRow(page);
    await expect(row).toBeVisible();
    await expect(row).toContainText(CUSTOMER.mobile);
    // `open`, the server's word. The mock's `new` does not exist and must not be rendered.
    await expect(statusOf(page, 'open')).toBeVisible();
    // Unclaimed: no name in the Assigned cell, and the desk is offered the Claim action.
    await expect(row.getByRole('button', { name: 'Claim' })).toBeVisible();
    await expect(row).toContainText('Home Loans');
  });

  test('the status tiles use the server’s five words, not the mock’s three', async ({ page, login }) => {
    await openBoard(page, login);

    /* `new` and `Done` were mock inventions. Asserting their *absence* is the point: a tile that
       filters on a status the server will never return is a permanently empty tab, and the way
       that shows up in life is a desk concluding there is no work. */
    await expect(tile(page, 'Open requests')).toHaveText(/[1-9]\d*$/);
    await expect(tile(page, 'In Progress requests')).toBeVisible();
    await expect(tile(page, 'Resolved requests')).toBeVisible();
    await expect(page.getByText(/^(New|Done) requests$/)).toHaveCount(0);

    // The status filter and the drawer offer all five, including the two the mock could not say at all.
    await page.getByLabel('Filter by status').click();
    await expect(page.getByRole('option')).toHaveText(['All statuses', 'Open', 'In Progress', 'Waiting', 'Resolved', 'Closed']);
    await page.keyboard.press('Escape');

    const drawer = await openDrawerFor(page);
    await expect(drawer.getByLabel('Status', { exact: true })).toHaveText(/open/i);
    await drawer.getByLabel('Status', { exact: true }).click();
    await expect(page.getByRole('option')).toHaveCount(5);
    await expect(page.getByRole('option', { name: 'Waiting' })).toBeVisible();
  });

  test('claiming writes the staffer’s own name, resolved by the server, and does not advance the ticket', async ({ page, login }) => {
    await openBoard(page, login);

    await ourRow(page).getByRole('button', { name: 'Claim' }).click();
    await expect(page.getByText(/Assigned to you/i)).toBeVisible();

    /* The name on screen came back from `TicketMapper`, which looked the assignee id up — the
       browser never typed it. That is the whole difference between the old board and this one:
       previously any string at all could land in the assignee column. */
    await expect(ourRow(page)).toContainText(LOANS_STAFF.name);
    await expect(ourRow(page).getByRole('button', { name: 'Claim' })).toHaveCount(0);

    // Naming an assignee is not declaring the work underway: still `open`, so Resolve is not offered.
    await expect(statusOf(page, 'open')).toBeVisible();
    await expect(ourRow(page).getByRole('button', { name: 'Resolve' })).toHaveCount(0);
  });

  test('a note is appended, not written over the list, and survives a reload', async ({ page, login }) => {
    await openBoard(page, login);

    const drawer = await openDrawerFor(page);
    await expect(drawer.getByText('No notes yet.')).toBeVisible();

    await drawer.getByPlaceholder(/Add an internal note/i).fill('Spoke to the owner, awaiting the Index II.');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Request updated')).toBeVisible();
    await expect(drawer).toHaveCount(0);

    /* Two notes, both surviving. `POST /{id}/notes` exists precisely because the old board sent
       the whole array back, so whichever of two colleagues saved second erased the other. */
    await openDrawerFor(page);
    await expect(drawer.getByText(/Spoke to the owner/)).toBeVisible();
    await drawer.getByPlaceholder(/Add an internal note/i).fill('Owner sending it tomorrow.');
    await drawer.getByRole('button', { name: 'Save' }).click();
    await expect(drawer).toHaveCount(0);

    await openDrawerFor(page);
    await expect(drawer.getByText(/Spoke to the owner/)).toBeVisible();
    await expect(drawer.getByText(/Owner sending it tomorrow/)).toBeVisible();

    // And the author is the server's idea of who is signed in, not a string the page composed.
    await expect(drawer.getByText(LOANS_STAFF.name).first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Home Loans' })).toBeVisible();
    await openDrawerFor(page);
    await expect(drawer.getByText(/Spoke to the owner/)).toBeVisible();
    await expect(drawer.getByText(/Owner sending it tomorrow/)).toBeVisible();
  });

  test('a staffer sees their own desk and not another’s', async ({ page, login }) => {
    /* The negative half of D44. `TicketService.list` narrows a staff caller to their own desk, so
       a legal ticket must simply not be on a loans staffer's board — and this is asserted with a
       ticket that provably exists, because "no legal rows" is otherwise indistinguishable from
       "no legal tickets". */
    const legal = await seedTicket({ team: 'legal', detail: 'A question about the clause.' });
    expect(legal.team).toBe('legal');

    await openBoard(page, login);

    await expect(ourRow(page)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'A question about the clause.' })).toHaveCount(0);
  });
});
