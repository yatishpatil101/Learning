/** Every ticket is raised by the spec with a run-stamped subject because the board is shared and append-only. */
import fs from 'node:fs';
import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, apiLogin, authHeaders } from '../../helpers/liveAuth.js';
import { appReady } from '../../helpers/app.js';

const run = () => `E2E svc desk ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function raise(request, subject, { team = 'loans', priority } = {}) {
  const res = await request.post(`${API}/tickets`, {
    headers: await authHeaders(ACTORS.tenant),
    data: { team, subject, priority, body: 'Two-bedroom move, ground floor to third floor.' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

const adminBoard = async (request) => {
  const res = await request.get(`${API}/tickets?team=loans&size=100`, { headers: await authHeaders(ACTORS.admin) });
  expect(res.status()).toBe(200);
  return (await res.json()).content;
};

const adminPatch = async (request, id, data) => {
  const res = await request.patch(`${API}/tickets/${id}`, { headers: await authHeaders(ACTORS.admin), data });
  expect(res.status(), await res.text()).toBe(200);
};

const serverTicket = async (request, id) => {
  const res = await request.get(`${API}/tickets/${id}`, { headers: await authHeaders(ACTORS.admin) });
  expect(res.status()).toBe(200);
  return res.json();
};

const pick = async (page, ariaLabel, option) => {
  await page.getByLabel(ariaLabel, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

const openDesk = async (page, login, path = '/admin/home-loans') => {
  await login.asAdmin();
  await page.goto(path);
  await appReady(page);
  await expect(page.getByRole('heading', { name: 'Home Loans', exact: true })).toBeVisible();
};

const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const tabCount = (page, key) => page.getByTestId(`tab-count-${key}`);
const priority = (page, name) => page.getByRole('group', { name: 'Priority' }).getByRole('button', { name, exact: true }).click();
const rowOf = (page, text) => page.getByTestId('queue-row').filter({ hasText: text });

test('the tab counts tally the board the API serves, and each filter and the CSV narrow to the ticket they name', async ({ page, request, login }) => {
  test.slow();
  const tag = run();
  const urgent = `${tag} urgent`;
  const low = `${tag} low`;
  const parked = `${tag} parked`;
  await raise(request, urgent, { priority: 'urgent' });
  await raise(request, low, { priority: 'low' });
  const parkedId = await raise(request, parked, { priority: 'high' });
  await adminPatch(request, parkedId, { status: 'waiting' });

  const board = await adminBoard(request);
  const count = (status) => board.filter((t) => t.status === status).length;
  expect(count('open'), 'the three raised tickets leave the board with open work on it').toBeGreaterThan(0);

  await openDesk(page, login);
  for (const key of ['open', 'in-progress', 'waiting', 'resolved', 'closed']) {
    await expect(tabCount(page, key)).toHaveText(String(count(key)));
  }
  await expect(tabCount(page, 'all')).toHaveText(String(board.length));

  await tab(page, 'All').click();
  await page.getByPlaceholder('Search id, customer, detail…').fill(tag);
  await expect(rowOf(page, tag)).toHaveCount(3);
  await expect(page.getByTestId('queue-range').first()).toHaveText('1–3 of 3');

  await tab(page, 'Waiting').click();
  await expect(rowOf(page, tag)).toHaveCount(1);
  await expect(rowOf(page, parked)).toHaveCount(1);
  await expect(rowOf(page, parked).getByRole('button', { name: 'Start' }), 'a waiting ticket is not offered Start').toHaveCount(0);
  await expect(rowOf(page, parked).getByRole('button', { name: 'Resolve' })).toHaveCount(0);
  await tab(page, 'All').click();

  await priority(page, 'Urgent');
  await expect(rowOf(page, tag)).toHaveCount(1);
  await expect(rowOf(page, urgent)).toBeVisible();
  await expect(rowOf(page, urgent).getByText('urgent', { exact: true })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csv = fs.readFileSync(await (await download).path(), 'utf8');
  expect(csv.split('\n')[0]).toBe('"ID","Service","Desk","Customer","Mobile","Detail","Priority","Assigned","Status","Created"');
  expect(csv, 'the export is the filtered view').toContain(urgent);
  expect(csv).not.toContain(low);
  expect(csv).not.toContain(parked);
  await priority(page, 'All');

  await page.getByPlaceholder('Search id, customer, detail…').fill(`${tag} no such ticket`);
  await expect(page.getByText('No requests match', { exact: true })).toBeVisible();
});

test('Resolve on the row closes an in-progress ticket on the server and moves the tab counts with it', async ({ page, request, login }) => {
  const subject = run();
  const id = await raise(request, subject);
  await adminPatch(request, id, { status: 'in-progress' });

  await openDesk(page, login);
  await tab(page, 'In progress').click();
  await page.getByPlaceholder('Search id, customer, detail…').fill(subject);
  const row = rowOf(page, subject);
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('button', { name: 'Start' })).toHaveCount(0);
  await expect(row.getByText(/today|\d+d open/)).toBeVisible();

  const inProgress = Number(await tabCount(page, 'in-progress').innerText());
  const resolved = Number(await tabCount(page, 'resolved').innerText());

  await row.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByRole('alert')).toContainText('Request resolved');

  expect((await serverTicket(request, id)).status).toBe('resolved');
  await expect(row, 'a resolved ticket leaves the In progress tab').toHaveCount(0);
  await expect(tabCount(page, 'in-progress')).toHaveText(String(inProgress - 1));
  await expect(tabCount(page, 'resolved')).toHaveText(String(resolved + 1));

  await tab(page, 'Resolved').click();
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
  await expect(row.getByText(/today|\d+d open/), 'a resolved ticket carries no age chip').toHaveCount(0);
});

test('a deep link opens the ticket, and Save parks it on Waiting with a note without assigning it', async ({ page, request, login }) => {
  const subject = run();
  const id = await raise(request, subject);
  const customer = (await apiLogin(ACTORS.tenant)).user;
  const admin = (await apiLogin(ACTORS.admin)).user;
  const note = `Waiting on the customer to confirm the date ${subject}`;

  await openDesk(page, login, `/admin/home-loans?open=${id}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`Request ${id}`, { exact: true })).toBeVisible();
  await expect(dialog).toContainText(customer.name);
  await expect(dialog).toContainText(ACTORS.tenant);
  await expect(dialog.getByText('Unassigned')).toBeVisible();
  await expect(dialog.getByText('No notes yet.')).toBeVisible();

  await pick(page, 'Status', 'Waiting');
  await dialog.getByPlaceholder('Add an internal note…').fill(note);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('Request updated');
  await expect(dialog).toHaveCount(0);

  const after = await serverTicket(request, id);
  expect(after.status).toBe('waiting');
  expect(after.assignee, 'leaving Assign to unchanged does not assign').toBeFalsy();
  expect(after.notes.map((n) => n.text)).toEqual([note]);

  await tab(page, 'Waiting').click();
  await page.getByPlaceholder('Search id, customer, detail…').fill(subject);
  const row = rowOf(page, subject);
  await expect(row.getByText('waiting', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(dialog.getByText(note)).toBeVisible();
  await expect(dialog).toContainText(admin.name);
  await expect(dialog.getByText('No notes yet.')).toHaveCount(0);
});

test('a board that cannot be read says so instead of showing an empty one', async ({ page, login }) => {
  await login.asAdmin();
  await page.route(/\/api\/tickets(\?|$)/, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'The ticket board is unavailable.' }),
    }));
  await page.goto('/admin/home-loans');

  await expect(page.getByRole('heading', { name: 'Home Loans', exact: true })).toBeVisible();
  await expect(page.getByText('The ticket board is unavailable.')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Ticket statuses' })).toHaveCount(0);
  await expect(page.getByText('No requests match')).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('writes to a ticket are refused to a buyer, to nobody, and to another desk — and leave it as it was', async ({ request }) => {
  const id = await raise(request, run());
  const url = `${API}/tickets/${id}`;
  const attempts = [
    ['no session', {}],
    ['a buyer', await authHeaders(ACTORS.buyer)],
    ['another desk', await authHeaders(STAFF.packers)],
  ];

  for (const [who, headers] of attempts) {
    const patch = await request.patch(url, { headers, data: { status: 'closed' } });
    expect([401, 403], `${who} may not change the status`).toContain(patch.status());
    const note = await request.post(`${url}/notes`, { headers, data: { body: 'Sneaked in.' } });
    expect([401, 403], `${who} may not add a note`).toContain(note.status());
  }

  const untouched = await serverTicket(request, id);
  expect(untouched.status).toBe('open');
  expect(untouched.notes ?? []).toHaveLength(0);

  const own = await request.patch(url, { headers: await authHeaders(STAFF.loans), data: { status: 'in-progress' } });
  expect(own.status(), 'the desk that owns the ticket is let through, so the refusals above were about who asked').toBe(200);
  expect((await serverTicket(request, id)).status).toBe('in-progress');
});
