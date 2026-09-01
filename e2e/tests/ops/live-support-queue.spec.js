import { expect, MOBILE, test } from '../../fixtures/live.js';
import { API, apiLogin } from '../../helpers/liveAuth.js';

/* Ops → Support queue, against the live API (D51).

   `GET /admin/support-tickets` is the endpoint that had a server, a partial index (V53) and a test
   suite and no caller until this screen was written. This spec is the mock version converted, and
   the conversion is mostly a *strengthening* rather than a rewiring, because three of the things
   the screen claims were unfalsifiable against `lib/data/support.js`:

   - **The two-sided read model (D50/V53) is two columns, not one boolean.** `unread` is the
     raiser's — "support replied and I have not looked" — and `staff_unread` is the desk's — "a
     customer message nobody here has read". The mock had one store and one flag, so "opening a
     ticket clears the desk's side and does not touch the customer's" was a sentence about code
     that could only be checked by reading the code. Here it is checked by re-reading the ticket as
     the customer afterwards.
   - **`AdminSupportTicket` withholds the mobile.** On the mock the store simply had no mobile to
     leak, so asserting one was absent proved nothing about the contract. Here the raiser exists in
     `users` with a real ten-digit number that `GET /support/tickets/{id}` will happily show the
     same caller — the queue omitting it is a decision, and this is where it is held.
   - **Staff can read and answer a ticket that is not theirs.** The whole screen rests on it, and on
     the mock every provider call went to the same unguarded store. Live, `readable()` is a filter
     on `userId == caller || isOps(caller)`, and the reply lands with `authorRole = staff`.

   Fixtures. The seeded database opens with exactly one support ticket — Priya Nair's missing rent
   receipt, two messages, `staff_unread = true` — which is the working queue at baseline. Tests that
   would consume it are ordered after the ones that need it, and the loop test raises its own ticket
   through `POST /support/tickets` as the customer rather than reusing the seed, so it can assert on
   text nobody else wrote. */

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

/* The global cookie-consent banner is also `role="dialog"`, and this screen's thread modal is
   looked up by that role. Seeding consent keeps the two from colliding — same reason as the mock
   spec, and unrelated to the API the page reads. */
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
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

/**
 * The customer's own view of their ticket — the other half of every two-sided assertion here.
 *
 * `who` matters: `readable()` admits the raiser or ops and nobody else, so reading Priya's ticket
 * as Rahul answers 404. Throwing on a non-200 keeps that from arriving as `undefined` in an
 * assertion three lines later, which reads like the flag was wrong rather than the caller.
 */
async function asCustomer(id, who = CUSTOMER) {
  const { accessToken } = await apiLogin(who);
  const res = await fetch(`${API}/support/tickets/${id}`, { headers: auth(accessToken) });
  if (res.status !== 200) throw new Error(`asCustomer(${who}): ${res.status} ${await res.text()}`);
  return res.json();
}

test.describe('Ops → Support queue (live)', () => {
  test('an unauthenticated visitor is redirected from /ops/support to staff-login', async ({ page }) => {
    await page.goto('/ops/support');

    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'Support queue' })).toHaveCount(0);
  });

  test('the working queue is what the server says is waiting, and carries no mobile number', async ({ page, login, consoleErrors }) => {
    await seedConsent(page);
    await login.asStaff('rental');
    await page.goto('/ops/support');

    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();
    await expect(page.getByText('Every support conversation on the platform, newest first.')).toBeVisible();

    // The three server-backed views: ?awaitingReply=true | false | omitted. `undefined` is not
    // `false` — sending `false` for "no filter" would hide exactly the unanswered tickets.
    await expect(page.getByRole('button', { name: 'Awaiting reply' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Answered' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All', exact: true })).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: SEEDED.subject });
    await expect(row).toBeVisible();
    // The raiser is a display name, and "Us" is the desk's own side of the read model.
    await expect(row.getByText(SEEDED.raiser)).toBeVisible();
    await expect(row.getByText('Us', { exact: true })).toBeVisible();

    /* The withheld field. Priya has a real ten-digit mobile in `users`, and
       `GET /support/tickets/{id}` shows it to this very caller — so its absence here is the
       schema's decision rather than an accident of what the fixture happened to hold. A list is the
       shape that gets exported, and this list is the whole platform's support traffic.

       `MOBILE` is anchored for a reason — see `fixtures/live.js`. The queue is every ticket on the
       platform, including ones other specs raised with a `Date.now()` stamp in the subject, and a
       millisecond timestamp contains a ten-digit run that looks exactly like a mobile. */
    const table = await page.getByRole('table').innerText();
    expect(table).not.toMatch(MOBILE);

    expect(consoleErrors).toEqual([]);
  });

  test('an empty view is stated as empty, and never as the result of a failed read', async ({ page, login }) => {
    await seedConsent(page);
    await login.asStaff('rental');
    await page.goto('/ops/support');
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();

    /* Nothing has been answered yet, so `?awaitingReply=false` is genuinely empty. The distinction
       being asserted is the one that ends a shift early: a `.catch(() => [])` would render "nothing
       here" over a broken request, and the two sentences are not interchangeable. Scoped to the
       table because `Table` prints the empty message twice — once per viewport variant. */
    await page.getByRole('button', { name: 'Answered' }).click();
    await expect(page.getByRole('table').getByText('No tickets in this view.')).toBeVisible();
    await expect(page.getByText('This is not an empty queue')).toHaveCount(0);
    await expect(page.getByText('Nothing in this view')).toBeVisible();
  });

  test('opening a ticket shows the thread and clears the desk’s side of the read model, not the customer’s', async ({ page, login }) => {
    await seedConsent(page);
    await login.asStaff('rental');
    await page.goto('/ops/support');
    await page.getByRole('row').filter({ hasText: SEEDED.subject }).click();

    /* The row carries no thread — `AdminSupportTicket` omits it so a page of twenty tickets is not
       an unbounded response — so the modal fetches `GET /support/tickets/{id}`. That this succeeds
       at all is the staff read right: the ticket belongs to Priya, and `readable()` admits ops. */
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(SEEDED.customerLine)).toBeVisible();
    await expect(dialog.getByText(SEEDED.staffLine)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Reading cleared `staff_unread`, so the ticket has left the working queue for real — not just
    // in the row the page patched locally. Assert it through **Answered** first: the desk is
    // already standing on the Awaiting tab, and clicking the tab you are on changes no state and
    // therefore refetches nothing, so an emptiness checked there would only be re-reading the list
    // the page already had. Coming back to Awaiting from another tab is a genuine second read.
    await page.getByRole('button', { name: 'Answered' }).click();
    await expect(page.getByRole('row').filter({ hasText: SEEDED.subject })).toBeVisible();
    await page.getByRole('button', { name: 'Awaiting reply' }).click();
    await expect(page.getByRole('row').filter({ hasText: SEEDED.subject })).toHaveCount(0);

    /* And the customer's side is untouched. This is the half the mock could not express: one store
       and one flag meant "the desk read it" and "the customer read it" were the same bit, so a
       desk clearing its own signal would silently have marked the customer's reply as seen. */
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
    await page.getByRole('row').filter({ hasText: subject }).click();
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

    await page.getByRole('button', { name: 'Answered' }).click();
    await expect(page.getByRole('row').filter({ hasText: subject })).toBeVisible();

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
    await expect(page.getByRole('row').filter({ hasText: subject })).toBeVisible();
  });
});
