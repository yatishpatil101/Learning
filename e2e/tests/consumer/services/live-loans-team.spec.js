/**
 * A home-loan enquiry is routed to the dedicated Loans desk against the **live** backend.
 *
 * ## What this is, and what it is not
 *
 * `live-admin-services.spec.js` already owns the *board*: it proves a `loans` ticket reaches the
 * console labelled "Home Loans" rather than `loans`, and that Assign-to offers only that desk
 * (`live-admin-services.spec.js:210`). But it raises its ticket over the API with the team passed
 * in by hand. Nothing on the live side has ever driven the **consumer** form and checked which desk
 * the enquiry actually landed on — that assertion existed only in the mock suite, where it read the
 * routing key back out of `puneNestDB_v5`.
 *
 * That is the gap this closes, and it is a real one. `team="loans"` is a single prop on
 * `HomeLoans.jsx:49`; if it were dropped or mistyped the page would look identical, the customer
 * would get the same confirmation, and the enquiry would simply never appear on the loans desk. The
 * mock test could not have caught the version of that bug that matters, because the store it read
 * is written by the browser — it was checking that the page told itself the truth.
 *
 * ## Why the enquiry is found by an id delta rather than by a marker in its text
 *
 * The obvious approach — stamp a unique string into a free-text field and grep the desk for it —
 * does not work here, and quietly: `GET /tickets` returns a list projection with **no `body`**, so
 * a marker written into the enquiry detail is invisible to every reader on this side. A filter on
 * it matches nothing and reads as "the enquiry never arrived" when in fact it arrived intact.
 * Snapshotting the desk's ids before the submit and diffing after is immune to that, and it also
 * survives a seeded or previously-written desk, which an absolute count would not.
 *
 * ## Why the negative is asserted from the legal desk rather than as `!== 'legal'`
 *
 * The mock wrote `expect(ticket.team).not.toBe('legal')`, which is implied by the positive and so
 * adds nothing. The failure it was reaching for is a routing one: finance folded back into
 * Property & Legal, where a home-loan enquiry sits in a queue nobody staffing it is qualified to
 * work. Diffing the legal desk across the same submit is that claim, stated where it is
 * falsifiable. `STAFF.legal` is signed into rather than assumed, so the absence cannot pass because
 * the account was suspended.
 */
import { expect, test, STAFF } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, signedInAsNew } from '../../../helpers/liveAuth.js';

const PAGE = '/home-loans';

/** The loan product picked below. `serviceField: 'loanType'` makes it the enquiry's subject. */
const LOAN_TYPE = 'Home Purchase Loan';

/**
 * The form's dropdowns are the project's own `Select` (via `NativeSelect`), not a native
 * `<select>`, so `selectOption` never resolves against them. `getByLabel` does not work either:
 * `ServiceLanding` renders a bare `<label>` with no `htmlFor` and passes no `aria-label`
 * (`ServiceLanding.jsx:188`, `NativeSelect.jsx:44`), so the control has no accessible name at all.
 * The `data-err` wrapper is the anchor the rest of the suite uses.
 */
async function pickOption(page, field, label) {
  await page.locator(`[data-err="${field}"] .pn-dropdown__trigger`).click();
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

/** Read a desk's queue as the staffer who works it, and hand back the rows. */
async function deskQueue(team, mobile) {
  const res = await fetch(`${API}/tickets?team=${team}&size=100`, { headers: await authHeaders(mobile) });
  expect(res.status, `the ${team} desk is readable by its own staff`).toBe(200);
  const body = await res.json();
  return body?.content || [];
}

const idsOf = (rows) => new Set(rows.map((r) => r.id));

test.describe('home loans routing, live', () => {
  test('a home-loan enquiry is filed against the Loans desk, and never reaches legal', async ({ page }) => {
    /* Both desks are signed into before anything is filed. The absence assertion at the end is only
       meaningful if the legal desk is an account that could have received the enquiry. */
    const loansDesk = await apiLogin(STAFF.loans);
    const legalDesk = await apiLogin(STAFF.legal);
    expect(loansDesk.accessToken).toBeTruthy();
    expect(legalDesk.accessToken).toBeTruthy();

    const loansBefore = idsOf(await deskQueue('loans', STAFF.loans));
    const legalBefore = idsOf(await deskQueue('legal', STAFF.legal));

    /* A brand-new account rather than the seeded buyer. This submit is an authenticated *write*,
       and the seeded actors are reused across the suite: by the time this file runs, another spec
       may have signed the buyer in over HTTP, and a refresh rotates the whole token family
       (ADR-008), so the browser's session is invalidated behind this test's back. It fails in a way
       that names none of that — the app logs the customer out mid-submit and lands on `/signin`
       while the page has *already* shown "Request received!", so the desk read below finds nothing
       and reads as a routing bug. Cost several runs before the failure snapshot was read rather
       than the assertion. `signedInAsNew` gives this test a session nothing else touches. */
    const customer = await signedInAsNew(page);
    expect(customer, 'a fresh account was registered for this submit').toBeTruthy();
    await page.goto(PAGE);

    await pickOption(page, 'loanType', LOAN_TYPE);
    await page.locator('[data-err="amount"] input').fill('5000000');
    /* The name is filled rather than left to prefill. `ServiceLanding` copies it off the session,
       and a newly-registered account may not carry one, in which case validation blocks the submit
       and the failure looks identical to a submit the server refused. */
    await page.locator('input[data-err="name"]').fill('Loans Routing Probe');

    /* Armed before the click, because the response can arrive before the next line runs.

       This is the assertion the test used to be missing, and the reason it failed roughly one run
       in three. `ServiceLanding` calls `setDone(true)` synchronously and leaves the POST in a
       fire-and-forget chain (`ServiceLanding.jsx:123-132`), so "Request received!" appears while
       the request is still in the air — and its rejection is swallowed, so it appears even when the
       request fails outright. Treating that panel as proof the submit had completed meant the desk
       was read whenever the browser felt like painting, sometimes before the row existed. The
       result was an empty queue reported as "the enquiry never reached the loans desk", which is
       the one conclusion the evidence did not support. */
    const filed = page.waitForResponse(
      (r) => r.url().includes('/api/tickets') && r.request().method() === 'POST',
      { timeout: 15000 },
    );

    await page.getByRole('button', { name: 'Get Loan Offers' }).click();

    const response = await filed;
    expect(response.status(), 'the server accepted the enquiry').toBeLessThan(300);

    /* Kept, but demoted: the panel is what the customer is told, and it is worth knowing they are
       told it. It is no longer load-bearing for the reads below. */
    await expect(page.getByRole('heading', { name: 'Request received!' })).toBeVisible({ timeout: 15000 });

    const arrivedOnLoans = (await deskQueue('loans', STAFF.loans)).filter((t) => !loansBefore.has(t.id));
    expect(arrivedOnLoans, 'the enquiry reached the loans desk').toHaveLength(1);
    expect(arrivedOnLoans[0].team).toBe('loans');

    /* The subject is what an operator reads first. `serviceField` is why it is the product name and
       not a generic "Service request" — a desk of identically-titled rows is a desk nobody triages. */
    expect(arrivedOnLoans[0].subject).toBe(LOAN_TYPE);

    const arrivedOnLegal = (await deskQueue('legal', STAFF.legal)).filter((t) => !legalBefore.has(t.id));
    expect(arrivedOnLegal, 'the finance vertical is not folded back into Property & Legal').toHaveLength(0);
  });
});
