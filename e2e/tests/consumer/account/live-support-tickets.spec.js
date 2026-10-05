import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

/*
 * Consumer support against the live API — `/support` behind ProtectedRoute, `/contact` public.
 *
 * The desk's half of this domain is already live in `ops/live-support-queue.spec.js`. The
 * customer's half was not, which is the half where the two-sided read model (D50) is actually
 * raised: `unread` is "a staff reply the customer has not opened", `staff_unread` is "a customer
 * message nobody on the desk has read", and they are not opposites.
 *
 * Three things the retired mock spec could not do, and this one does:
 *
 *   1. **It asserted the ticket id by shape** — `/SUP-\d+/`, calling it "a server-style SUP-<seq>
 *      id". No such format exists on the server: `supportMapper.js` passes `id: t.id` straight
 *      through and the live id is a UUID. `SUP-` was minted by `providers/mock/supportProvider.js`
 *      and by nothing else, so the assertion described the mock and would have failed the moment it
 *      met the API it claimed to imitate. The id is now compared against the one the *server*
 *      returned, read outside the browser — the two must agree, and neither is pattern-matched.
 *   2. **Its empty-state test leaned on a seeded actor staying empty.** The seed gives Priya
 *      (`ACTORS.tenant`) one open ticket with two messages, so "no tickets yet" is a claim about
 *      whoever is signed in. It runs on a throwaway account, where the claim is structural.
 *   3. **Its create test mutated whoever it signed in as.** The live database resets once per run,
 *      not per file, so a ticket minted on a named actor outlives this file. Creation runs on a
 *      throwaway account too.
 *
 * Nothing in this file changes a seeded actor.
 */

/**
 * The global cookie-consent banner is also `role="dialog"`, so it would both overlay the page and
 * collide with the ticket-thread lookup. Seeded before load, exactly as the retired spec did.
 */
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

/** The raiser's own ticket list, read outside the browser. */
async function ticketsOf(mobile) {
  const response = await fetch(`${API}/support/tickets`, { headers: await authHeaders(mobile) });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  return JSON.parse(body);
}

/** Open `/support` for a mobile already signed in, and wait for the list read rather than a paint. */
async function openSupport(page) {
  const loaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/api/support/tickets') &&
    response.request().method() === 'GET' &&
    response.status() === 200,
  );
  await page.goto('/support');
  await loaded;
  await expect(page.getByRole('heading', { name: 'Help & Support' })).toBeVisible();
}

/** One seeded question, quoted exactly. Chosen because its answer is the platform's core claim. */
const ANCHOR_Q = 'Is Draazy really zero brokerage?';

/** A second, from a different category, so the assertion is not about one lucky row. */
const OTHER_Q = 'How do I report a suspicious listing or user?';

/** The categories the nine seeded FAQ rows carry. Asserted as a subset, so adding a tenth is not a failure. */
const FAQ_CATEGORIES = ['General', 'Trust', 'Seekers', 'Owners', 'Payments', 'Services', 'Coverage'];
test.describe('Consumer support — live API', () => {
  test('guards /support behind sign-in, while /contact stays public', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await page.goto('/support');
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/next=/);
    await expect(page.getByRole('heading', { name: 'Help & Support' })).toHaveCount(0);

    await page.goto('/contact');
    await expect(page.getByRole('heading', { name: 'Get in touch' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Send an enquiry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send enquiry' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('a new account sees the support shell and the empty state for a ticket list the server holds nothing for', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    const mobile = await signedInAsNew(page);
    await openSupport(page);

    await expect(page.getByRole('heading', { name: 'Raise a new ticket' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit ticket' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your tickets' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible();

    /* The premise is asserted rather than assumed. A seeded actor could acquire a ticket from any
       other spec in the run; a throwaway account cannot, and saying so here means a failure names
       the fixture instead of the empty state. */
    expect(await ticketsOf(mobile), 'a brand-new account starts with no tickets').toHaveLength(0);

    await expect(page.getByText('No tickets yet')).toBeVisible();
    await expect(page.getByText("Raise a ticket and it'll show up here.")).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('creating a ticket opens the thread carrying the id the server minted, and lists it', async ({ page }) => {
    await seedConsent(page);
    const mobile = await signedInAsNew(page);
    await openSupport(page);
    await expect(page.getByText('No tickets yet')).toBeVisible();

    /* The retired spec said "Buyer name + mobile are prefilled; only subject and message are
       needed". That held for the mock's seeded user and does not hold for a real new account: the
       mobile is prefilled and disabled - it is the account's own number, and support replies land
       on it - but the NAME is empty and required (`Support.jsx:140`), so the first run of this test
       submitted nothing and timed out waiting for a POST that validation had already refused.
       Filling it is both the fix and the more honest flow, since a first-time writer genuinely has
       to type it. */
    const subject = 'Refund not received for booking';
    const message = 'I paid for a visit booking but the refund has not arrived yet.';
    await page.getByPlaceholder('e.g. Rahul Sharma').fill('E2E Support Writer');
    await page.getByPlaceholder('Brief summary of your issue').fill(subject);
    await page.getByPlaceholder('Share as much detail as you can so we can help faster.').fill(message);

    const created = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/api/support/tickets') &&
      response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Submit ticket' }).click();
    /* The status of the write, not the state of the control: a 201 here is what makes every
       assertion below a statement about a row rather than about a form that cleared itself. */
    expect((await created).status(), 'the ticket create was refused').toBe(201);

    /* The server is now the source of the expected id. `TicketList` and `TicketThreadModal` both
       render `{t.id}` raw, so this is the two-components-must-agree case: fetch the value and
       compare it, never assert its shape. The retired spec matched `/SUP-\d+/`, which is a format
       only the mock has ever produced. */
    const [ticket] = await ticketsOf(mobile);
    expect(ticket, 'the create did not reach the database').toBeTruthy();
    expect(ticket.subject).toBe(subject);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(ticket.id, { exact: true })).toBeVisible();
    await expect(dialog.getByText(message)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('No tickets yet')).toHaveCount(0);
    await expect(page.getByText(subject)).toBeVisible();
    /* The list shows the same id as the thread did — the assertion the shape-match was standing in
       for, and the one that would catch a list keyed off a client-minted stand-in. */
    await expect(page.getByText(ticket.id, { exact: true }).first()).toBeVisible();
  });

  /* The copy is identical in the mock and on the server, so no text assertion proves where it came
     from. Provenance is the wait on `GET /api/faqs`, armed before navigation because the fetch fires
     from an effect during first paint; the API half is read without a browser so a UI regression and
     a contract regression cannot be mistaken for each other. Order is deliberately not asserted. */
  test('the FAQ list is a public read that needs no session, and the help page renders what the server returned', async ({ page, login }) => {
    await test.step('GET /api/faqs answers with no Authorization header', async () => {
      // No header at all, not a signed-out session: only that proves the route is genuinely public.
      const res = await fetch(`${API}/faqs`);
      expect(res.status).toBe(200);

      const faqs = await res.json();
      expect(Array.isArray(faqs)).toBe(true);
      expect(faqs.length).toBeGreaterThanOrEqual(9);

      const anchor = faqs.find((f) => f.question === ANCHOR_Q);
      expect(anchor).toBeTruthy();
      expect(anchor.id).toBeTruthy();
      expect(anchor.category).toBe('General');
      expect(anchor.answer).toContain('zero brokerage');

      // A question with no answer would open an accordion onto nothing.
      expect(faqs.every((f) => f.id && f.question && f.answer)).toBe(true);

      const seen = new Set(faqs.map((f) => f.category));
      for (const category of FAQ_CATEGORIES) expect(seen.has(category)).toBe(true);
    });

    await test.step('the help page asks for the list and renders it as openable accordions', async () => {
      await login.asBuyer();

      const faqsRequest = page.waitForResponse(
        (r) => new URL(r.url()).pathname.endsWith('/api/faqs') && r.status() === 200,
      );
      await page.goto('/support');
      await faqsRequest;

      await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible();

      // The button, not the text: a list rendered as inert paragraphs would not open.
      const anchor = page.getByRole('button', { name: ANCHOR_Q });
      await expect(anchor).toBeVisible();
      await expect(page.getByRole('button', { name: OTHER_Q })).toBeVisible();

      await anchor.click();
      await expect(page.getByText('zero brokerage', { exact: false }).first()).toBeVisible();
    });
  });
});

