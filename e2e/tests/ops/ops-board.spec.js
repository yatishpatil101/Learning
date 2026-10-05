import { expect, test } from '../../fixtures/live.js';
import { API, apiLogin } from '../../helpers/liveAuth.js';

/** Home Loans ticket board against the live API (`/admin/home-loans` over `GET|PATCH /tickets`). The suite mints
 * its own tickets: the seed ships none, and `POST /tickets` has no role guard on purpose. */

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

/** The status badge in that row. `exact` is load-bearing: each row also has an **Open** action button, so a
 * substring match hits two elements; the badge text is the server's lowercase word, capitalised only in CSS. */
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
    await expect(page.getByRole('heading', { name: 'Home Loans', exact: true })).toBeVisible();
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

    /* The name on screen comes from `TicketMapper` resolving the assignee id, not from browser input. */
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
    /* `TicketService.list` narrows staff to their own desk, so a legal ticket must be absent from a loans
       staffer's board; assert with a ticket that provably exists. */
    const legal = await seedTicket({ team: 'legal', detail: 'A question about the clause.' });
    expect(legal.team).toBe('legal');

    await openBoard(page, login);

    await expect(ourRow(page)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'A question about the clause.' })).toHaveCount(0);
  });
});
