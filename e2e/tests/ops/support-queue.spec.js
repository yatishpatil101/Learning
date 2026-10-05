import { expect, MOBILE, test } from '../../fixtures/live.js';
import { API, apiLogin } from '../../helpers/liveAuth.js';

/* Ops Support queue against the live API. Covers what the mock could not falsify: the two-sided read model
   (`unread` is the raiser's, `staff_unread` the desk's), the withheld mobile, staff answering others' tickets. */

/** Rahul Mehta — an ordinary buyer, and in this file the customer who writes in. */
const CUSTOMER = '9700000001';

/** Priya Nair — whoever the seed made the raiser of the seeded ticket. Not the same person. */
const SEEDED_RAISER = '9700000002';

/** The seeded ticket, verbatim from the fixture — note the em dash, which psql renders as a hyphen. */
const SEEDED = {
  subject: 'Rent receipt for July is missing',
  raiser: 'Priya Nair',
  customerLine: 'I paid July rent on the 3rd but the receipt never arrived by WhatsApp.',
  staffLine: 'Thanks for flagging — we can see the payment and are re-sending the receipt now.',
};

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

const stamp = () => Date.now().toString(36).slice(-5);

/* The cookie-consent banner is also `role="dialog"`; seeding consent avoids clashing with the thread modal. */
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

/** Raise a ticket as the customer, over the API. Returns `{ id, subject, body }`. */
async function raiseTicket(subject, body) {
  const { accessToken } = await apiLogin(CUSTOMER);
  const res = await fetch(`${API}/support/tickets`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({ subject, category: 'payment', body }),
  });
  if (res.status !== 201) throw new Error(`raiseTicket: ${res.status} ${await res.text()}`);
  const ticket = await res.json();
  return { id: ticket.id, subject, body };
}

/** The customer's own view of a ticket, for two-sided assertions. `readable()` admits only the raiser or ops, so
 * throw on a non-200 rather than let `undefined` surface in a later assertion. */
async function asCustomer(id, who = CUSTOMER) {
  const { accessToken } = await apiLogin(who);
  const res = await fetch(`${API}/support/tickets/${id}`, { headers: auth(accessToken) });
  if (res.status !== 200) throw new Error(`asCustomer(${who}): ${res.status} ${await res.text()}`);
  return res.json();
}

test.describe('Ops → Support queue (live)', () => {
  test('the working queue is what the server says is waiting, and carries no mobile number', async ({ page, login, consoleErrors }) => {
    await seedConsent(page);
    await login.asStaff('rental');
    await page.goto('/ops/support');

    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();
    await expect(page.getByText('Every support conversation on the platform, newest first.')).toBeVisible();

    // The three server-backed views: ?awaitingReply=true | false | omitted. `undefined` is not
    // `false` — sending `false` for "no filter" would hide exactly the unanswered tickets.
    await expect(page.getByRole('tab', { name: /^Awaiting reply/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Answered/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^All/ })).toBeVisible();
    // Every tab carries its server total, not just the open one.
    await expect(page.getByTestId('tab-count-awaiting')).toHaveText(/^[\d,]+$/);
    await expect(page.getByTestId('tab-count-answered')).toHaveText(/^[\d,]+$/);

    const row = page.getByTestId('queue-row').filter({ hasText: SEEDED.subject });
    await expect(row).toBeVisible();
    // The raiser is a display name, and "Us" is the desk's own side of the read model.
    await expect(row.getByText(SEEDED.raiser)).toBeVisible();
    await expect(row.getByText('Waiting on us', { exact: true })).toBeVisible();

    /* The mobile is withheld by the schema: Priya has one that GET /support/tickets/{id} shows this caller.
       MOBILE is anchored (see fixtures/live.js) because Date.now() stamps look like mobiles. */
    const queue = await page.getByRole('tabpanel').innerText();
    expect(queue).not.toMatch(MOBILE);

    expect(consoleErrors).toEqual([]);
  });

  test('an empty view is stated as empty, and never as the result of a failed read', async ({ page, login }) => {
    await seedConsent(page);
    await login.asStaff('rental');
    await page.goto('/ops/support');
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();

    /* `?awaitingReply=false` is genuinely empty here; this separates that from a `.catch(() => [])` hiding a broken request. */
    await page.getByRole('tab', { name: /^Answered/ }).click();
    await expect(page.getByText('No tickets in this view.')).toBeVisible();
    await expect(page.getByText('This is not an empty queue')).toHaveCount(0);
    await expect(page.getByTestId('queue-range').first()).toHaveText('0–0 of 0');
  });

  test('opening a ticket shows the thread and clears the desk’s side of the read model, not the customer’s', async ({ page, login }) => {
    await seedConsent(page);
    await login.asStaff('rental');
    await page.goto('/ops/support');
    await page.getByTestId('queue-row').filter({ hasText: SEEDED.subject }).getByRole('button', { name: 'Reply' }).click();

    /* The row omits the thread (`AdminSupportTicket` keeps pages bounded), so the modal fetches `GET /support/tickets/{id}`; success is the staff read right (`readable()` admits ops). */
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(SEEDED.customerLine)).toBeVisible();
    await expect(dialog.getByText(SEEDED.staffLine)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Reading cleared `staff_unread`; assert via **Answered** first, because clicking the tab you are on refetches
    // nothing, while coming back to Awaiting from another tab is a genuine second read.
    await page.getByRole('tab', { name: /^Answered/ }).click();
    await expect(page.getByTestId('queue-row').filter({ hasText: SEEDED.subject })).toBeVisible();
    await page.getByRole('tab', { name: /^Awaiting reply/ }).click();
    await expect(page.getByTestId('queue-row').filter({ hasText: SEEDED.subject })).toHaveCount(0);

    /* The customer's side is untouched: a desk clearing its own signal must not mark the customer's reply as seen. */
    const mine = await asCustomer('f1c70005-0000-4000-8000-000000000001', SEEDED_RAISER);
    expect(mine.unread).toBe(false);
    expect(mine.messages).toHaveLength(2);
  });

  test('a customer writes in, the desk answers, and the answer is written as the desk’s', async ({ page, login }) => {
    await seedConsent(page);
    const subject = `Visit was never confirmed ${stamp()}`;
    const body = 'The payment left my account but the booking still shows unpaid.';
    const ticket = await raiseTicket(subject, body);

    await login.asStaff('rental');
    await page.goto('/ops/support');

    // Straight into the working queue — a new ticket raises the desk's flag, opening message and all.
    await page.getByTestId('queue-row').filter({ hasText: subject }).getByRole('button', { name: 'Reply' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(body)).toBeVisible();

    const answer = 'Apologies — we have reconfirmed the slot for tomorrow 11am.';
    await dialog.getByPlaceholder('Reply to the customer…').fill(answer);
    await dialog.getByRole('button', { name: 'Send' }).click();
    // The bubble is the server's own message appended, not an optimistic echo: the id, the author
    // name and the timestamp are all its to decide.
    await expect(dialog.getByText(answer)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('tab', { name: /^Answered/ }).click();
    await expect(page.getByTestId('queue-row').filter({ hasText: subject })).toBeVisible();

    /* The customer's side, from the customer's own endpoint. The reply is attributed to staff and
       *their* unread flag is now raised — the direction the desk's own read never touches. */
    const mine = await asCustomer(ticket.id);
    expect(mine.unread).toBe(true);
    expect(mine.messages).toHaveLength(2);
    expect(mine.messages[1].body).toBe(answer);
    expect(mine.messages[1].authorRole).toBe('staff');
  });

  test('an admin can work the same queue', async ({ page, login }) => {
    await seedConsent(page);
    const subject = `Wrong locality on my listing ${stamp()}`;
    await raiseTicket(subject, 'The locality on my listing is not where the flat is.');

    await login.asAdmin();
    await page.goto('/ops/support');

    // `RoleRoute roles=['staff','admin']` mirrors the endpoint's `x-roles` exactly — the screen
    // lives under /ops rather than /admin precisely so staff are not locked out of it.
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();
    await expect(page.getByTestId('queue-row').filter({ hasText: subject })).toBeVisible();
  });
});
