import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

/* Consumer support against the live API (`/support` behind ProtectedRoute, `/contact` public); the ticket id is compared with the server's UUID, not pattern-matched.
 * Empty-state and create tests run on throwaway accounts because the live DB resets per run, so seeded actors must not be mutated. */

/** The cookie-consent banner is also `role="dialog"` and would overlay the page and collide with the ticket-thread lookup, so it is
 * seeded before load. */
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

    /* Assert the premise: a throwaway account can't hold a ticket from another spec. */
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

    /* Mobile is prefilled and disabled; the NAME is empty and required (`Support.jsx:140`). */
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

    /* Both ticket components render `{t.id}` raw, so fetch the expected id; never assert its shape. */
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

  /* Copy is identical in mock and server, so provenance is the `GET /api/faqs` wait, armed before navigation as it
     fires from an effect during first paint; the API half is read without a browser. */
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

