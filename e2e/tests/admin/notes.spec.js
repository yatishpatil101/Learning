/* Internal notes — what the team writes to itself about a case (D29).
 *
 * ## What was broken
 *
 * Four moderation handlers wrote a note into `db.internalNotes` in this browser's localStorage in
 * the same breath as a real API call. Approve a listing and the decision went to the server while
 * the reasoning stayed on one laptop. Two members of staff working the same queue each saw their
 * own notes and none of each other's, and nothing on screen said so — an empty history and a
 * history you cannot see render identically. The read on a *person* was worse: it returned `[]`
 * unconditionally, because nothing ever wrote a `user:` key.
 *
 * ## What these tests are for
 *
 * They are deliberately about **crossing a boundary**, because that is the whole of what changed.
 * A test that writes a note and reads it back in the same session would have passed against the
 * localStorage store on the day it was broken. So:
 *
 * - one session writes, a **different signed-in account** reads it back;
 * - a note on a **person** survives closing and reopening the drawer.
 *
 * ## Why this is still a mock spec, stated honestly
 *
 * The reason recorded here used to be that "the mock provider enforces the same two server rules
 * — a closed set of entity kinds and no blank note — so a call site that breaks either fails
 * here, in a suite that runs in seconds, rather than only against a live backend".
 *
 * That is a **speed** argument, not a coverage one, and speed is exactly the ground the
 * mock-retirement policy stopped accepting: mock goes where it is *used*, not merely where it is
 * inconvenient to remove. Worse, it describes a spec whose subject is the fake's fidelity to the
 * real thing — which can only ever restate a claim the live suite already owns, and quietly
 * becomes false the day the two drift, in the direction of the fake.
 *
 * So the five tests below are not one bucket. They are two:
 *
 * - **Genuinely client-only, and the reason this file still exists.** `the Add note button will
 *   not file an empty note` is a claim about a control that never issues a request — no server can
 *   be asked whether a button was disabled. `a decision taken without a note is not a failure` is
 *   the same shape from the other side: it pins that the note is *optional*, i.e. that the absence
 *   of one does not block the decision, which is a branch in the handler rather than a row anywhere.
 * - **Duplicates of live coverage, kept only for the run time.** `survives the decision and is
 *   there for whoever opens the listing next` and `the note carries the byline of whoever wrote it`
 *   are both `live-notes.spec.js` (`a note one account files is read by another, under the
 *   writer's name`); `a note on an account is there when the drawer is opened again` is the drawer
 *   test in the same file. These three prove nothing here that is not proved there against
 *   Postgres, and they prove it against a store that agrees with the client by construction.
 *
 * The gap this docblock used to name is closed. `a note lands on the timeline that had a style for
 * it and no source` has moved to `live-notes.spec.js` as `a note taken during a review is on the
 * timeline when the case file is reopened` — the communication log rendering a note is a
 * server-observable claim, the row has to come back on the log read, so it belonged over there.
 * Converting it found a real defect this file could not have seen: the console addresses a listing
 * by slug and the enquiries board by uuid, and notes were being filed into two separate histories
 * under one listing. One localStorage database serving every login here agrees with whichever id
 * it is handed, so both halves passed.
 *
 * `live-notes.spec.js` is what proves the seam reaches Postgres and that two *different people* see
 * the same row.
 *
 * Fixtures: `login.asAdmin()`, `login.asStaff()`.
 */
import { test, expect } from '../../fixtures/base.js';

/** Signed in as admin, on the properties console, with cards rendered. */
async function openProperties(page, login) {
  await login.asAdmin();
  await page.goto('/admin/properties');
  await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
  await expect(page.locator('.list-card').first()).toBeVisible();
}

/* `writeNote` and `openNoteHistory` were retired with the tests that used them. `openNoteHistory`
   carried one fact worth keeping in writing, because it is not obvious and the live version depends
   on it: a listing's note history is read through the **Archive** modal rather than the Flag one,
   even though the Flag form is where these notes get written. `AdminPropertyCard` swaps the Flag
   button for "Clear flag & publish" the moment a listing is flagged, so the modal that took the
   note cannot be reopened on the same listing. Archive mounts the identical widget on the identical
   entity — which is the point, and is exactly why the cross-modal read is worth asserting at all:
   the history belongs to the listing, not to the modal that happened to collect it. */

test.describe('A note filed beside a decision', () => {
  /* `survives the decision and is there for whoever opens the listing next` and `the note carries
     the byline of whoever wrote it` were retired here on 2026-08-25 into the flag test in
     `live-properties-console.spec.js`, which files a note from the Flag form and then reads it back
     out of the *Archive* form on the same listing after a reload — the cross-modal read is the part
     that was worth keeping, and it is stronger there than it was here because the note has made a
     round trip through the notes table rather than through this browser's own localStorage.

     The byline went with it. Both tests asserted `getByText(/Admin|Staff/)` beside the note, which
     under the mock provider was a string the store put there; against the real API the name is
     resolved server-side from the token, so the same assertion is now about something. */

  test('a decision taken without a note is not a failure', async ({ page, login }) => {
    await openProperties(page, login);
    const card = page.locator('.list-card').first();

    await card.locator('[title="Archive"]').click();
    const archive = page.getByRole('dialog', { name: 'Archive listing' });
    await archive.getByRole('button', { name: 'Archive', exact: true }).click();

    /* The label says "optional" and the ordinary case is that nobody types anything. The old store
       wrote a row anyway whenever there was an action label, which drew an empty bullet under a
       colleague's name; the server refuses it outright. Neither must reach the operator as an
       error. */
    await expect(page.getByText('Listing archived', { exact: true })).toBeVisible();
    await expect(page.getByText(/could not be saved/)).toHaveCount(0);
  });
});

test.describe('Notes on a person', () => {
  /* `a note on an account is there when the drawer is opened again` was retired here on 2026-08-25.
     Its persistence claim was always the weakest thing in this file — the panel closed and reopened
     against one localStorage database, so the browser was reading its own writing and would have
     passed on the day the notes turned out to be a private diary. `live-notes.spec.js:284` makes it
     across two accounts and one table.

     Two of its assertions were ported before the deletion rather than after: the empty state
     (`Nobody has written a note about this account yet`), which under this provider used to be the
     *only* state the panel could reach, since the store read a key nothing ever wrote and so every
     account looked clean; and the Escape close, which is the only exit from the drawer that does
     not require finding a control. Both now run against a freshly minted account, which is the only
     subject that can honestly be said to have no notes. */

  test('the Add note button will not file an empty note', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await page.locator('table').locator('[title="View activity"]').first().click();

    const notes = page.getByTestId('user-notes');
    await expect(notes.getByRole('button', { name: 'Add note' })).toBeDisabled();
    await notes.getByRole('textbox').fill('   ');
    await expect(notes.getByRole('button', { name: 'Add note' })).toBeDisabled();
  });
});
