import { test, expect } from '../../fixtures/base.js';

/* Ops → Support queue (D51). The screen for `GET /admin/support-tickets`, which had a paged,
   role-guarded, indexed server endpoint and no caller.

   Behaviour verified from:
     - pages/ops/OpsSupportQueue.jsx (tabs, paging, thread modal, reply),
     - services/supportService.js → providers/mock|http/supportProvider.js (listSupportQueue),
     - lib/data/support.js (the mock store; `unreadStaff` is what "awaiting reply" means),
     - App.jsx: /ops/support sits under RoleRoute roles=['staff','admin'] — matching the
       endpoint's own x-roles: [staff, admin] — so any signed-in staffer or admin may work it,
       and a signed-out visitor is bounced to /staff-login.

   This is NOT pages/admin/AdminSupport.jsx, which is the unrouted ops board over the
   services.ticket mock and a different resource entirely.

   The mock support store starts empty (there is no seed), so every queue assertion here first
   raises a real ticket through the consumer surface — which is also the honest end-to-end shape:
   a customer writes in, and the desk sees it. */

// The global cookie-consent banner is also role="dialog"; seed consent so it never overlays the
// queue or collides with the thread-dialog lookup (pattern from support-tickets.spec.js).
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

const CUSTOMER_MESSAGE = 'The payment left my account but the booking still shows unpaid.';

/*
 * Sign the customer in **without** `login.asBuyer`, on purpose.
 *
 * `seedUser` installs the session through `page.addInitScript`, which Playwright re-runs on every
 * navigation for the life of the page. That is right for a spec with one identity and wrong for
 * this one: the staff quick-login writes `puneNestUser`, and the very next navigation re-runs the
 * buyer's init script and writes it straight back — so `/ops/support` bounces to `/staff-login`
 * and the queue is never reached. Writing the session once, after the app has loaded, lets the
 * later sign-in win. The ticket itself lives under a different key (`puneNestSupport`) and is not
 * seeded, so it survives the switch untouched.
 */
async function signInAsCustomer(page) {
  await page.goto('/');
  await page.evaluate((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
  }, { name: 'Test Buyer', mobile: '9876500001', role: 'buyer', loginAt: Date.now() });
  await page.reload();
}

/** Raise one ticket as a signed-in buyer and return its subject. */
async function raiseTicket(page, subject) {
  await signInAsCustomer(page);
  await page.goto('/support');
  await page.getByPlaceholder('Brief summary of your issue').fill(subject);
  await page
    .getByPlaceholder('Share as much detail as you can so we can help faster.')
    .fill(CUSTOMER_MESSAGE);
  await page.getByRole('button', { name: 'Submit ticket' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  return subject;
}

test.describe('Ops → Support queue', () => {
  test('an unauthenticated visitor is redirected from /ops/support to staff-login', async ({ page }) => {
    await page.goto('/ops/support');

    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'Support queue' })).toHaveCount(0);
  });

  test('the queue loads for a staffer and states an empty queue as empty', async ({ page, login, consoleErrors }) => {
    await seedConsent(page);
    await login.asStaff('Rental');
    await page.goto('/ops/support');

    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();
    await expect(page.getByText('Every support conversation on the platform, newest first.')).toBeVisible();

    // The three server-backed filters (?awaitingReply=true | false | omitted).
    await expect(page.getByRole('button', { name: 'Awaiting reply' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Answered' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All', exact: true })).toBeVisible();

    // Empty is stated as empty — and distinctly from the load-failure card, which says so.
    // Scoped to the table because `Table` renders the empty message twice: once in the
    // mobile card stack and once as a full-width row, with CSS choosing between them.
    await expect(
      page.getByRole('table').getByText('Nothing is waiting on us. Every customer message has been read.'),
    ).toBeVisible();
    await expect(page.getByText('This is not an empty queue')).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });

  test('a ticket a customer raised appears under "Awaiting reply" with its summary fields', async ({ page, login }) => {
    await seedConsent(page);
    const subject = await raiseTicket(page, 'Refund not received for booking');

    await login.asStaff('Rental');
    await page.goto('/ops/support');
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: subject });
    await expect(row).toBeVisible();
    // The summary DTO's fields, and only those: id, subject, category, status, raiser, waiting-on.
    await expect(row.getByText(/SUP-\d+/)).toBeVisible();
    await expect(row.getByText('Us', { exact: true })).toBeVisible();
  });

  test('the queue never exposes a raiser mobile number', async ({ page, login }) => {
    await seedConsent(page);
    await raiseTicket(page, 'Cannot upload my agreement');

    await login.asStaff('Rental');
    await page.goto('/ops/support');
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();

    // AdminSupportTicket carries no mobile, and the mock provider drops the one its store holds.
    // No ten-digit Indian mobile may appear in the queue — the raiser is a display name only.
    const table = await page.getByRole('table').innerText();
    expect(table).not.toMatch(/(?:\+91[\s-]?)?[6-9]\d{9}/);
  });

  test('replying moves the ticket out of the awaiting queue and into Answered', async ({ page, login }) => {
    await seedConsent(page);
    const subject = await raiseTicket(page, 'Visit was never confirmed');

    await login.asStaff('Rental');
    await page.goto('/ops/support');
    await page.getByRole('row').filter({ hasText: subject }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(CUSTOMER_MESSAGE)).toBeVisible();

    const answer = 'Apologies — we have reconfirmed the slot for tomorrow 11am.';
    await dialog.getByPlaceholder('Reply to the customer…').fill(answer);
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(dialog.getByText(answer)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // The reply was written as the staff side of the thread (D50), so the customer is no longer
    // waiting on us: the row is found under "Answered".
    await page.getByRole('button', { name: 'Answered' }).click();
    await expect(page.getByRole('row').filter({ hasText: subject })).toBeVisible();
  });

  test('an admin can work the same queue', async ({ page, login }) => {
    await seedConsent(page);
    await raiseTicket(page, 'Wrong locality on my listing');

    await login.asAdmin();
    await page.goto('/ops/support');

    // RoleRoute roles=['staff','admin'] mirrors the endpoint's x-roles exactly.
    await expect(page.getByRole('heading', { name: 'Support queue' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Wrong locality on my listing' })).toBeVisible();
  });
});
