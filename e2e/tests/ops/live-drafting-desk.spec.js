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
import { API, apiLogin, signIn, uniqueMobile } from '../../helpers/liveAuth.js';

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
 * An Indian mobile, and *only* a whole one.
 *
 * The desk shows request ids with long digit runs in them, and an unanchored `[6-9]\d{9}` finds a
 * "mobile" inside every one. That is the kind of assertion that fires forever and so gets loosened
 * until it protects nothing. The lookarounds pin the match to a complete digit run.
 */
const MOBILE = /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/;

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
});
