import { test, expect } from '../../fixtures/base.js';

/* Ops → Drafting desk (D173). The screen for `GET /service-requests/{id}/identities` — the desk's
   half of the identity-disclosure design (D151), which had a refusal-tested, audited server route
   and no caller.

   Behaviour verified from:
     - pages/ops/OpsDraftingDesk.jsx (queue, filters, take, reveal/hide, allow-listed details),
     - services/serviceRequestService.js → providers/mock|http/serviceRequestProvider.js,
     - backend ServiceRequestIdentityService.forAssignee (the two refusal sentences, reproduced
       verbatim by the mock provider because the refusal IS the design),
     - App.jsx: /ops/drafting-desk sits under RoleRoute roles=['staff','admin'], matching the
       endpoint's own guard.

   The mock request store is seeded by OpsServiceQueue's mount (`seedDemo()`), so each test that
   needs rows visits /ops/rent-agreement first — the same warm-up the other ops specs use.

   The disclosure rules this spec exists to hold:
     - numbers only after the operator takes the matter,
     - a refusal is shown, with the server's own sentence,
     - Hide clears them,
     - closing and reopening does not restore them (nothing is cached beyond the view),
     - the id of an open request never enters the URL,
     - the queue itself never shows an identity number or a mobile. */

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

/** Sign in as a staffer and warm the mock request store, then open the desk. */
async function openDesk(page, login) {
  await seedConsent(page);
  await login.asStaff('Rental');

  // `seedDemo()` runs in an effect on OpsServiceQueue's mount, and that page is `lazy()` — so
  // `goto` resolving on `load` proves nothing: navigating straight on races the chunk and leaves
  // the store empty, which the desk then honestly reports as an empty queue. Wait for the write
  // itself, not for a paint.
  await page.goto('/ops/rent-agreement'); // mounts OpsServiceQueue → seedDemo()
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((k) => k.startsWith('puneNestServiceReq:')));

  await page.goto('/ops/drafting-desk');
  await expect(page.getByRole('heading', { name: 'Drafting desk' })).toBeVisible();
}

const UNASSIGNED_REFUSAL = /not assigned to anyone yet/;

/*
 * An Indian mobile, and *only* a whole one.
 *
 * The desk shows request ids of the shape `SR178634283919842` — `SR` plus a 15-digit stamp — and an
 * unanchored `[6-9]\d{9}` finds a "mobile" inside every one of them. That would make this the kind
 * of assertion that fires on ids forever and so gets loosened until it protects nothing. The
 * lookarounds pin the match to a complete digit run, which is what a real mobile always is.
 */
const MOBILE = /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/;

/*
 * The PAN row of the disclosure panel.
 *
 * `exact` is the whole point. The default `getByText('PAN')` matches a *substring*,
 * case-insensitively, and the seeded owner is "Rahul Desh**pan**de". Which of the three seeded
 * rental matters sorts first depends on `updatedAt`, and `seedDemo()` writes all three inside the
 * same millisecond — so the loose form passed or failed by luck of the draw, and the assertion
 * that Hide clears the numbers was being decided by a name in a summary field rather than by the
 * panel it is about. (`getByRole('term')` is not the fix: `term` takes its accessible name from
 * the author, not from its content, so it matches nothing here.)
 */
const panRow = (dialog) => dialog.getByText('PAN', { exact: true });

test.describe('Ops → Drafting desk', () => {
  test('an unauthenticated visitor is redirected from /ops/drafting-desk to staff-login', async ({ page }) => {
    await page.goto('/ops/drafting-desk');

    await expect(page).toHaveURL(/\/staff-login/);
    await expect(page.getByRole('heading', { name: 'Drafting desk' })).toHaveCount(0);
  });

  test('the desk lists the live request queue with its filters', async ({ page, login, consoleErrors }) => {
    await openDesk(page, login);

    await expect(page.getByText("The live service-request queue, and the parties' identity numbers for a matter you hold.")).toBeVisible();
    await expect(page.getByLabel('Filter by desk')).toBeVisible();
    await expect(page.getByLabel('Filter by status')).toBeVisible();

    // Seeded requests from lib/serviceFlow.seedDemo().
    await expect(page.getByRole('row').filter({ hasText: 'Rent Agreement' }).first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('the queue itself never carries an identity number or a mobile', async ({ page, login }) => {
    await openDesk(page, login);

    // Identity numbers are one matter at a time or nothing — never a list column — and no
    // service-request field puts a raw mobile on this screen.
    const table = await page.getByRole('table').innerText();
    expect(table).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/);        // PAN
    expect(table).not.toMatch(/\b\d{4}\s?\d{4}\s?\d{4}\b/);      // Aadhaar
    expect(table).not.toMatch(MOBILE);
  });

  test('an unassigned request refuses the reveal, in the server\'s own words', async ({ page, login }) => {
    await openDesk(page, login);
    await page.getByRole('row').filter({ hasText: 'Rent Agreement' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Held by nobody')).toBeVisible();

    await dialog.getByRole('button', { name: 'Reveal' }).click();

    // The refusal is rendered, not swallowed — and it says which move unblocks it.
    await expect(dialog.getByText(UNASSIGNED_REFUSAL)).toBeVisible();
    await expect(panRow(dialog)).toHaveCount(0);
  });

  test('taking the request unlocks the reveal, and Hide puts it away again', async ({ page, login }) => {
    await openDesk(page, login);
    await page.getByRole('row').filter({ hasText: 'Rent Agreement' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Take this request' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This request is now yours' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Reveal' }).click();

    // The disclosure panel appears with the parties, and the audit notice is on screen with it.
    await expect(panRow(dialog).first()).toBeVisible();
    await expect(dialog.getByText(/every attempt — allowed or\s+refused — is recorded/)).toBeVisible();
    await expect(dialog.getByText(UNASSIGNED_REFUSAL)).toHaveCount(0);

    // Hide clears it from the view (and from component state — there is nowhere else it lives).
    await dialog.getByRole('button', { name: 'Hide' }).click();
    await expect(panRow(dialog)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('a disclosure does not survive closing the matter, and never reaches the URL', async ({ page, login }) => {
    await openDesk(page, login);
    await page.getByRole('row').filter({ hasText: 'Rent Agreement' }).first().click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Take this request' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This request is now yours' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Reveal' }).click();
    await expect(panRow(dialog).first()).toBeVisible();

    // Rule 3: the open request's id is not a route param, so nothing identifying is in history.
    await expect(page).toHaveURL(/\/ops\/drafting-desk$/);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Rule 1: reopening starts from nothing — the numbers are not cached beyond the view.
    await page.getByRole('row').filter({ hasText: 'Rent Agreement' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(panRow(page.getByRole('dialog'))).toHaveCount(0);
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  test('the request summary shows named fields only, never the raw details object', async ({ page, login }) => {
    await openDesk(page, login);
    await page.getByRole('row').filter({ hasText: 'Rent Agreement' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Property')).toBeVisible();
    await expect(dialog.getByText('Monthly rent')).toBeVisible();

    // `details._state` is the wizard's form snapshot: PAN/Aadhaar are redacted out of it, but the
    // parties' mobile numbers are not. The allow-list is what keeps it off the screen.
    const body = await dialog.innerText();
    expect(body).not.toMatch(/_state/);
    expect(body).not.toMatch(MOBILE);
  });
});
