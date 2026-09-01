/**
 * LIVE integration check for the drafting desk (D173/D151) — the five disclosure tests that used to
 * run in mock mode, moved here by D184.
 *
 * Run it explicitly (it is excluded from the default suite by `playwright.config.js`, and matched
 * by `playwright.live.config.js`'s `/live-.*\.spec\.js/`):
 *
 *   cd e2e; npx playwright test tests/ops/live-drafting-desk.spec.js --config=playwright.live.config.js
 *
 * Sign-in is `helpers/liveAuth.js` - the `e2e` profile fixes the OTP, so nothing scrapes the backend
 * log any more.
 *
 * ## Why it had to move
 *
 * The desk sends `?status=` in the server's vocabulary; the mock store's rows carried the stepper's,
 * so in mock mode most filters matched nothing and the desk looked idle when it was not. Rather than
 * translate between two vocabularies — a mapping that exists only to make a demo look right, and a
 * third place to edit whenever the server adds a status — the mock's three desk operations were
 * removed and the screen now gates on `isHttpDomain('serviceRequest')`. That left these assertions
 * with no mock to run against. They are security assertions, so they were moved rather than dropped.
 *
 * ## Why it seeds through the API and asserts through the UI
 *
 * The seeded database has users but **no service requests** - `R__zz_dev_demo_data.sql` has none -
 * so a spec that merely opened the desk would find an empty queue and pass its `not.toMatch`
 * assertions while proving nothing. It would pass just as happily with the disclosure guard deleted.
 *
 * So the customer half is done over HTTP, the way `serviceRequest-parity.mjs` does it: sign in, POST
 * a request, PUT identities on it. That is setup, and driving a multi-step wizard to produce it
 * would test the wizard, not this screen. The desk half — take, reveal, refuse, hide, reopen — is
 * driven through the UI, because *that* is what these assertions are about.
 *
 * ## The rules this file exists to hold
 *
 *   - numbers only after the operator takes the matter,
 *   - a refusal is shown, in the server's own sentence,
 *   - Hide clears them,
 *   - closing and reopening does not restore them (nothing is cached beyond the view),
 *   - the id of an open request never enters the URL,
 *   - the queue itself never shows an identity number or a mobile.
 */
import { test, expect } from '@playwright/test';
import { ACTORS, MOBILE } from '../../fixtures/live.js';
import { API, apiLogin, authHeaders, signIn, signedInAsNew, uniqueMobile } from '../../helpers/liveAuth.js';

/* A seeded consumer (any account may raise a service request) and a seeded `valuation` staffer —
   the desk is scoped by team, so the staffer must match the request's type. Both are from
   `R__zz_dev_demo_data.sql`; they are read, never written, so re-runs are safe.

   ## Why the valuation desk and not the rental one

   This spec used to raise a `rent-agreement` and sign in as a `rental` staffer, and the queue was
   empty every time. That is not a bug in either half: `rent-agreement` is the one *priced* type
   (`ServiceRequestService.priceFor`), so it is created at `awaiting-payment`, and
   `ServiceRequestRepository.findForQueue` excludes that status on purpose — "ops does not work a
   rent agreement nobody has paid for". Only the signature-verified payment webhook moves it to
   `new`, and COVERAGE.md already records that gate as reachable from `ServiceRequestFlowTest`
   rather than from here.

   The two ways to keep the rental desk were both worse than switching desks. Forging the webhook
   means reproducing a signature in a spec; adding a settle-this-request endpoint means growing the
   production API to suit a test, and a way to mark a request paid without money is the last thing
   this surface should learn. `valuation` is free to file, so it starts at `new` and is in the queue
   the moment it is created — and none of the rules below are about rent agreements. They are about
   the disclosure guard, which is the same code for every type. */
// Kept for documentation: this is what a seeded consumer looks like. `seedRequest` deliberately
// uses a throwaway account instead -- see the note there.
// eslint-disable-next-line no-unused-vars
const CUSTOMER = { mobile: '9708919481', name: 'Omkar Kulkarni' };
const STAFFER = { mobile: '9383334640', name: 'Karan Chavan' };

/* Values only this spec writes, so an assertion that finds one has found *our* row and not a
   coincidence. The PAN pattern is the server's own (`^[A-Za-z]{5}[0-9]{4}[A-Za-z]$`). */
const OWNER_PAN = 'ZZZQA1234Z';
const OWNER_AADHAAR = '999988887777';

/*
 * An Indian mobile, and *only* a whole one. The desk shows request ids with long digit runs in
 * them, and an unanchored `[6-9]\d{9}` finds a "mobile" inside every one. Shared from
 * `fixtures/live.js`, where the full reasoning lives, after a second spec was bitten by its own
 * unanchored copy.
 */

/* The PAN row of the disclosure panel. `exact` matters: the default `getByText('PAN')` matches a
   substring, case-insensitively, and a party named "Deshpande" contains one. */
const panRow = (dialog) => dialog.getByText('PAN', { exact: true });

const UNASSIGNED_REFUSAL = /not assigned to anyone yet/;

/**
 * Create one rental request as the customer and record the owner's identity numbers on it.
 *
 * The numbers are the point: without them the reveal has nothing to disclose, and "the panel is
 * empty" would look the same as "the guard held".
 */
async function seedRequest() {
  // A *fresh* raiser per request, not the seeded CUSTOMER. Every test here mutates its matter --
  // takes it, closes it -- so they cannot share one. An unknown mobile is auto-registered as a buyer
  // on first verify, and the spec never asserts on who raised it, so a throwaway account is the
  // cheapest way to keep the tests independent. CUSTOMER stays as the documented example of a
  // seeded consumer.
  const { accessToken } = await apiLogin(uniqueMobile());
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };

  const created = await fetch(`${API}/service-requests`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      // One of the five strings `ServiceRequestTypes.KNOWN` allows -- the server rejects anything
      // else on purpose, because an unrecognised type used to miss the exact-match pricer and file a
      // *free* rent agreement that ops then worked for nothing. `teamFor` routes this one to
      // `Teams.VALUATION`, which is why STAFFER's team is the right desk to assert against, and it
      // is free to file, which is why it reaches the queue at all (see the STAFFER note above).
      type: 'valuation',
      details: { ownerName: 'Live Desk Owner', property: 'Live spec flat, Baner', purpose: 'Live spec valuation' },
    }),
  });
  const dto = await created.json();
  if (created.status >= 300) throw new Error(`create failed (${created.status}): ${JSON.stringify(dto)}`);

  const put = await fetch(`${API}/service-requests/${dto.id}/identities`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({
      parties: [
        { partyRole: 'owner', partyIndex: 0, partyName: 'Live Desk Owner', pan: OWNER_PAN, aadhaar: OWNER_AADHAAR },
      ],
    }),
  });
  if (put.status >= 300) throw new Error(`identities failed (${put.status}): ${await put.text()}`);

  return dto;
}

/** Sign the staffer in through the real `/staff-login` OTP flow and open the desk. */
async function openDesk(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });

  await signIn(page, STAFFER.mobile, { screen: 'staff' });

  await page.goto('/ops/drafting-desk');
  await expect(page.getByRole('heading', { name: 'Drafting desk' })).toBeVisible();
  // The gate this screen now has: in live mode it must render the queue, not the offline panel.
  await expect(page.getByText(/needs the live API/i)).toHaveCount(0);
}

/** The row for the matter this spec created — matched on its own property string, not on position. */
const ourRow = (page) => page.getByRole('row').filter({ hasText: 'Live spec flat' }).first();

/* Unheld 2026-08-13, when `/staff-login` was converted to the live API (Phase 4, the `team` domain).
 *
 * The hold was the operator's sign-in, not these assertions: `StaffLogin.jsx` used to read
 * `getTeamMemberByMobile` out of `lib/mockApi.js`, fabricate a user from the row it found and hand
 * that object to `staffLogin(...)`, which under the http provider wants `{ email, password }` and
 * throws. The screen now signs staff in through the ordinary `/auth/login` mobile-OTP route — the
 * one the server actually offers a browser, since D206 left staff accounts passwordless until an
 * emailed invite is redeemed — and takes the role and team from the response rather than from a
 * radio button. That is why `openDesk` below can reach `/ops/drafting-desk` at all.
 *
 * Unholding it surfaced a second, older defect these assertions had been hiding behind the `fixme`:
 * the fixture raised a `rent-agreement`, which is the one priced type and so never leaves
 * `awaiting-payment` without a payment webhook — a status `findForQueue` excludes by design. The
 * desk was correct and the queue was genuinely empty. The fixture now uses the free `valuation`
 * desk; see the STAFFER note above for why that is the honest fix rather than faking a settlement.
 */
test.describe('Ops → Drafting desk (live)', () => {
  test.beforeEach(async () => { await seedRequest(); });

  test('the desk lists the server queue with its filters', async ({ page }) => {
    await openDesk(page);

    await expect(page.getByLabel('Filter by desk')).toBeVisible();
    await expect(page.getByLabel('Filter by status')).toBeVisible();
    await expect(ourRow(page)).toBeVisible();
  });

  /* The replacement for the `TeamRoute` test that died with `/ops/legal`. Those five per-team
     routes were one component over `localStorage`, so once consumers filed through the seam the
     desks were reading a store the work no longer arrived in; they now redirect here with
     `?type=` set. `TeamRoute` went with them, which is safe because it was never what held the
     line — `ServiceDeskAuthority.deskFilterFor` ignores a `team` a staff caller does not own
     (D44), so a Valuation staffer asking for the legal desk was always going to be answered with
     their own rows. What the guard *did* provide was a reason on screen instead of a silent
     empty table, and that is what the picker now provides: their own desk and nothing to pick. */
  test('a staffer is offered their own desk and no other, whichever desk they ask for', async ({ page }) => {
    await openDesk(page);

    const desk = page.getByLabel('Filter by desk');
    await expect(desk).toHaveText(/Property Valuation/);
    await desk.click();
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Escape');

    // The old bookmark resolves, and asking for someone else's desk changes nothing on screen.
    await page.goto('/ops/legal');
    await expect(page).toHaveURL(/\/ops\/drafting-desk\?type=legal/);
    await expect(page.getByLabel('Filter by desk')).toHaveText(/Property Valuation/);
    await expect(ourRow(page)).toBeVisible();
  });

  /* The document checklist (D120). The five retired desks each carried a document list with a
     viewer over `localStorage`, plus a "Mark all verified" button; only the *reading* half comes
     back, because the server folds this list from the request's own vault documents at read time
     and there is no item state to tick. That is the point of asserting the missing items rather
     than the present ones: a checklist that could only show what arrived would be unable to say
     what a desk is waiting for, which is the one question it exists to answer. */
  test('a matter names the paperwork it is waiting for', async ({ page }) => {
    await openDesk(page);
    await ourRow(page).click();

    const drawer = page.getByRole('dialog');
    // Seeded over HTTP with no uploads, so every item is outstanding — and the count is the
    // server's own, off the envelope, not a tally this screen made up.
    await expect(drawer.getByText('0 of 5 received')).toBeVisible();
    for (const item of [
      'Owner Aadhaar + PAN',
      'Tenant Aadhaar + PAN',
      'Ownership proof (Index II / tax receipt)',
      'Passport photos (all parties)',
      'Latest electricity bill',
    ]) {
      await expect(drawer.getByText(item, { exact: true })).toBeVisible();
    }

    // Read-only, and it says so rather than leaving an operator hunting for the button.
    await expect(drawer.getByText(/nothing to mark here/i)).toBeVisible();
    await expect(drawer.getByRole('button', { name: /verified/i })).toHaveCount(0);
  });

  test('the queue itself never carries an identity number or a mobile', async ({ page }) => {
    await openDesk(page);
    await expect(ourRow(page)).toBeVisible();

    const table = await page.getByRole('table').innerText();
    expect(table).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/);     // PAN
    expect(table).not.toMatch(/\b\d{4}\s?\d{4}\s?\d{4}\b/);   // Aadhaar
    expect(table).not.toMatch(MOBILE);
  });

  test("an unassigned request refuses the reveal, in the server's own words", async ({ page }) => {
    await openDesk(page);
    await ourRow(page).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Held by nobody')).toBeVisible();

    await dialog.getByRole('button', { name: 'Reveal' }).click();

    // The refusal is rendered, not swallowed — and it says which move unblocks it.
    await expect(dialog.getByText(UNASSIGNED_REFUSAL)).toBeVisible();
    await expect(panRow(dialog)).toHaveCount(0);
  });

  test('taking the request unlocks the reveal, and Hide puts it away again', async ({ page }) => {
    await openDesk(page);
    await ourRow(page).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Take this request' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This request is now yours' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Reveal' }).click();

    // The number that comes back is one only a round trip through Postgres can produce.
    await expect(panRow(dialog).first()).toBeVisible();
    await expect(dialog.getByText(OWNER_PAN)).toBeVisible();
    await expect(dialog.getByText(/every attempt — allowed or\s+refused — is recorded/)).toBeVisible();
    await expect(dialog.getByText(UNASSIGNED_REFUSAL)).toHaveCount(0);

    // Hide clears it from the view (and from component state — there is nowhere else it lives).
    await dialog.getByRole('button', { name: 'Hide' }).click();
    await expect(panRow(dialog)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('a disclosure does not survive closing the matter, and never reaches the URL', async ({ page }) => {
    await openDesk(page);
    await ourRow(page).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Take this request' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This request is now yours' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Reveal' }).click();
    await expect(panRow(dialog).first()).toBeVisible();

    // The open request's id is not a route param, so nothing identifying is in history.
    await expect(page).toHaveURL(/\/ops\/drafting-desk$/);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Reopening starts from nothing — the numbers are not cached beyond the view.
    await ourRow(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(panRow(page.getByRole('dialog'))).toHaveCount(0);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('the request summary shows named fields only, never the raw details object', async ({ page }) => {
    await openDesk(page);
    await ourRow(page).click();

    const dialog = page.getByRole('dialog');
    // `exact`, for the same reason `panRow` needs it: the dialog's own title is the service name,
    // and "Property Valuation" contains "Property". The assertion is about the *label* of an
    // allow-listed detail row, so it has to match the whole `dt` and not the heading above it.
    await expect(dialog.getByText('Property', { exact: true })).toBeVisible();

    // The allow-list is what keeps the wizard's form snapshot off the screen.
    const body = await dialog.innerText();
    expect(body).not.toMatch(/_state/);
    expect(body).not.toMatch(MOBILE);
  });

  /*
   * The route guard, brought over from `ops/drafting-desk.spec.js` when that file was cut back to
   * its one mock-only keeper — and widened on the way, because mock mode could only prove the
   * weakest third of it.
   *
   * What it used to say was that a visitor with no session is bounced from `/ops/drafting-desk` to
   * staff-login. That is the only refusal a browser with no server behind it can observe, and it is
   * the one an attacker is least likely to test. This screen discloses PAN and Aadhaar numbers on
   * request; the interesting question is not what happens to a stranger but what happens to a real,
   * signed-in customer — an account that passes every "is anyone there?" check and must still be
   * turned away — and what happens when he skips the router altogether and calls the API himself.
   *
   * So the live version asserts three things. The router turns away a visitor with no session. The
   * router turns away a signed-in customer. And `GET /service-requests` answers that same customer
   * with **his own matters and not the desk's** — which, unlike the referral desk's flat 403, is the
   * shape the guard actually takes here: `OPS_MAY_SEE_THE_QUEUE` lets everybody through on purpose
   * because one route serves two audiences, and `ServiceRequestQueryService.list` picks
   * `findForQueue` or `findForRequester` off the caller's role. Asserting a 403 would therefore be
   * asserting a rule that does not exist, and would go green if the scoping were deleted.
   *
   * Both absences are anchored. The matter the customer must not see is one the *staffer* is shown
   * in the same breath, so its absence from the customer's list is a refusal rather than an empty
   * database; and the customer is given one matter of his own, so his list is demonstrably
   * non-empty and what he is missing is somebody else's row rather than every row.
   *
   * Mutation-proved against two different pieces of code, each reddening one assertion and no other.
   * Adding `buyer` to the ops `RoleRoute` in `App.jsx` reddens the redirect. Replacing the
   * role-branch in `ServiceRequestQueryService.list` with an unconditional
   * `findForQueue(null, …)` reddens the last line, handing the customer somebody else's matter.
   *
   * A third mutation was tried first and rejected: forcing `isOps(caller)` true sends a teamless
   * customer into `ServiceDeskAuthority.deskFilterFor`, which throws `ForbiddenException` rather
   * than leaking, so the test went red on the *status* line and the absence below it was never
   * reached. Red is not proof — a mutation has to redden the assertion whose failure you are
   * claiming to have ruled out, and a fail-closed error is a different failure from a leak.
   */
  test('the desk is staff-only at the router, and the API answers a customer with his own matters rather than the queue', async ({ page }) => {
    // The adversarial row: a matter raised by somebody else, sitting in the valuation queue.
    const theirs = await seedRequest();

    await page.goto('/ops/drafting-desk');
    await expect(page).toHaveURL(/\/staff-login/);

    const customer = await signedInAsNew(page);
    await page.goto('/ops/drafting-desk');
    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'Drafting desk' })).toHaveCount(0);

    // One matter of his own, so "he cannot see theirs" is scoping and not an empty list.
    const created = await fetch(`${API}/service-requests`, {
      method: 'POST',
      headers: await authHeaders(customer),
      body: JSON.stringify({
        type: 'valuation',
        details: { ownerName: 'Live Guard Customer', property: 'Live guard flat, Baner', purpose: 'Live spec guard' },
      }),
    });
    const mine = await created.json();
    expect(created.status, JSON.stringify(mine)).toBe(201);

    const listFor = async (mobile) => {
      const res = await fetch(`${API}/service-requests?size=100`, { headers: await authHeaders(mobile) });
      const body = await res.json();
      return { status: res.status, ids: (body.content || []).map((row) => row.id) };
    };

    // The positive anchor: without it, an endpoint broken for everybody would satisfy the absences.
    const desk = await listFor(STAFFER.mobile);
    expect(desk.status, JSON.stringify(desk)).toBe(200);
    expect(desk.ids).toContain(theirs.id);

    const his = await listFor(customer);
    expect(his.status, JSON.stringify(his)).toBe(200);
    expect(his.ids).toContain(mine.id);
    expect(his.ids).not.toContain(theirs.id);
  });

  /*
   * The `/ops` guard and the retired Rent Agreement bookmark, brought over from
   * `ops/requests.spec.js` when that file was cut back to its two offline-panel keepers.
   *
   * Three mock tests came here as one, and one of the three did not come at all. `/ops/legal` →
   * `?type=legal` is already owned, and owned better, by 'a staffer is offered their own desk and
   * no other' above: that test lands the same redirect and then shows the picker refusing to offer
   * anyone else's desk, which is the thing the redirect exists to make safe. Porting it again would
   * have been a second assertion of the same URL.
   *
   * `/ops/rent-agreement` is a different claim, and the only one of the five retired routes that is.
   * The other four map a word onto itself — `legal` → `legal`, `packers` → `packers` — so a test that
   * checks one of them cannot fail on a mistyped alias. This one renames. Twice, as the first run of
   * this test discovered: the route is `rent-agreement`, the URL it redirects to is `?type=rental`,
   * and what the desk then puts on the wire is `?type=rent-agreement` again, because `toWireType`
   * in `providers/http/serviceRequestProvider.js` translates the console's word back into the
   * server's. One desk, three spellings, and the route word and the wire word agree with each other
   * while disagreeing with the URL between them — which is precisely the arrangement in which a
   * half-applied rename looks correct from either end. Both hops are asserted, so breaking either
   * one reddens here.
   *
   * What mock mode could say about that was that the URL changed and the offline panel appeared. It
   * could not say the desk *honoured* it, which is the half that matters: `?type=` is only read
   * back out of the URL if it names a desk the picker knows (`OpsDraftingDesk.jsx`, `typeOpts`),
   * and anything else is silently dropped in favour of a fallback. A dropped filter and an applied
   * one look identical on a board nobody can load.
   *
   * So the filter is proved on the wire rather than on the screen: the request the desk actually
   * issues must carry `type=rental`, and the set it comes back with must be **strictly smaller**
   * than the unfiltered one. Smaller rather than merely different, because an unrecognised query
   * parameter is dropped by Spring without a 400 — a filter that reaches the server and is ignored
   * returns the whole board, and every assertion about what is *in* the answer would still hold.
   * The adversarial row is this spec's own `valuation` matter, seeded by `beforeEach` and named by
   * id: it is on the unfiltered board and must be off the rental one. Its presence upstream is what
   * stops its absence downstream from being an empty database, so no separate anchor is needed.
   *
   * The administrator rather than the staffer, because `typeOpts` narrows to a staffer's own desk
   * and the URL is then ignored by design — the case above already proves that. An admin keeps the
   * full list, so she is the only identity for whom `?type=` is load-bearing at all.
   *
   * The guard half is folded in rather than given its own test because it is one guard asked twice:
   * `/ops` is the front door and `/ops/rent-agreement` is a redirect that fires *inside* the same
   * shell, which is exactly the shape that can launder a stranger past a `RoleRoute` if the
   * `Navigate` is mounted outside it.
   *
   * Mutation-proved twice, once per half of the claim, each reddening one assertion and no other.
   * Replacing `type: type || undefined` with `type: undefined` in `OpsDraftingDesk.jsx`'s `load`
   * leaves the redirect, the URL and the desk label untouched and reddens the wire assertion alone —
   * the desk shows "Rent Agreement" while asking the server for every desk there is. Replacing
   * `r.type = :type` with a tautology in `ServiceRequestRepository.findForQueue` leaves the wire
   * assertion green and reddens the id-set delta alone — the console asks correctly and the server
   * hands back the whole board anyway, which is the failure the "an unknown query parameter is
   * dropped without a 400" rule exists to catch.
   */
  test('the retired Rent Agreement bookmark resolves to the Rental desk, and is no way past the shell guard', async ({ page }) => {
    // The adversarial row: a `valuation` matter, which belongs to a different desk than `rental`.
    const theirs = await seedRequest();

    await page.goto('/ops');
    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'My Dashboard' })).toHaveCount(0);

    await page.goto('/ops/rent-agreement');
    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'Drafting desk' })).toHaveCount(0);

    await signIn(page, ACTORS.admin, { screen: 'staff', role: /Administrator/ });

    /* The call the desk makes, not the rows that end up painted: a board still loading and a board
       filtered to nothing look the same, and only one of them is the claim.

       The *request* rather than the response, because reading a response body races the redirect
       that provoked it — `page.goto('/ops/rent-agreement')` loads a document whose only job is to
       navigate again, and the queue call it fires can have its body evicted before `.json()` gets
       there. That was caught here as a `Protocol error (Network.getResponseBody)` during the second
       mutation below, after two green runs: an intermittent failure that would have read as a bug
       in the desk. A request URL is recorded at issue time and cannot be evicted. What the server
       does with it is asserted separately, below. */
    const queueCall = async (url) => {
      const [req] = await Promise.all([
        page.waitForRequest((r) => /\/service-requests\?/.test(r.url()) && r.method() === 'GET'),
        page.goto(url),
      ]);
      return req.url();
    };

    const allCall = await queueCall('/ops/drafting-desk');
    expect(allCall).not.toContain('type=');
    await expect(page.getByLabel('Filter by desk')).toHaveText(/All desks/);

    const rentalCall = await queueCall('/ops/rent-agreement');
    await expect(page).toHaveURL(/\/ops\/drafting-desk\?type=rental/);
    await expect(page.getByLabel('Filter by desk')).toHaveText(/Rent Agreement/);

    // The alias reached the wire, in the server's spelling rather than the console's.
    expect(rentalCall).toContain('type=rent-agreement');

    /* And the server narrows on it rather than dropping it: the same endpoint the desk just called,
       asked twice as the same administrator, as an id-set delta. Strictly smaller, because an
       ignored query parameter still returns 200 with the whole board. */
    const idsFor = async (qs) => {
      const res = await fetch(`${API}/service-requests?size=100${qs}`, { headers: await authHeaders(ACTORS.admin) });
      const body = await res.json();
      expect(res.status, JSON.stringify(body)).toBe(200);
      return (body.content || []).map((row) => row.id);
    };
    const everyDesk = await idsFor('');
    const rentalDesk = await idsFor('&type=rent-agreement');

    expect(everyDesk).toContain(theirs.id);
    expect(rentalDesk).not.toContain(theirs.id);
    expect(rentalDesk.length).toBeLessThan(everyDesk.length);
  });
});
