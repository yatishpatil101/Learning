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
 * - the note appears on the **communication log**, which had an indigo `note` style and no producer;
 * - a note on a **person** survives closing and reopening the drawer.
 *
 * ## Why this is a mock spec as well as a live one
 *
 * The mock provider enforces the same two server rules — a closed set of entity kinds and no blank
 * note — so a call site that breaks either fails here, in a suite that runs in seconds, rather than
 * only against a live backend. `live-notes.spec.js` is what proves the seam actually reaches
 * Postgres and that two *different people* see the same row.
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

/** Expand the collapsed "Internal note (optional)" disclosure and type into it. */
async function writeNote(page, dialog, text) {
  await dialog.getByRole('button', { name: /Internal note \(optional\)/ }).click();
  const box = dialog.getByPlaceholder(/Add a note for the team/);
  await expect(box).toBeVisible();
  await box.fill(text);
}

/**
 * Open a listing's note history through the Archive modal.
 *
 * Not the Flag modal, even though that is where these notes are written: `AdminPropertyCard` swaps
 * the Flag button for "Clear flag & publish" once a listing is flagged, so the modal that took the
 * note cannot be reopened on the same listing. Archive mounts the identical widget on the identical
 * entity, which is the point — the history belongs to the listing, not to the modal that happened
 * to collect it.
 */
async function openNoteHistory(page, title) {
  const card = page.locator('.list-card', { hasText: title }).first();
  await expect(card).toBeVisible();
  await card.locator('[title="Archive"]').click();
  const dialog = page.getByRole('dialog', { name: 'Archive listing' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('A note filed beside a decision', () => {
  test('survives the decision and is there for whoever opens the listing next', async ({ page, login }) => {
    await openProperties(page, login);

    const card = page.locator('.list-card').first();
    const title = (await card.getByRole('heading').textContent()).trim();

    await card.locator('[title="Flag"]').click();
    const flag = page.getByRole('dialog', { name: 'Flag listing' });
    await flag.getByRole('textbox').first().fill('Photos look like a show flat');
    await writeNote(page, flag, 'Owner admitted the photos are the builder\u2019s.');
    await flag.getByRole('button', { name: 'Flag listing', exact: true }).click();

    /* The toast is the assertion that matters, not just that the modal closed: `saveNoteIfAny`
       reports a failed note by changing this wording, precisely so a note that did not save cannot
       hide behind a success message about the decision. */
    await expect(page.getByText('Listing flagged', { exact: true })).toBeVisible();

    // Reopen the same listing. The history is a fresh read through the seam.
    await page.reload();
    await expect(page.locator('.list-card').first()).toBeVisible();
    const reopened = await openNoteHistory(page, title);
    await reopened.getByRole('button', { name: /1 previous note/ }).click();
    await expect(reopened.getByText('Owner admitted the photos are the builder\u2019s.')).toBeVisible();
    await expect(reopened.getByText('Flagged', { exact: true })).toBeVisible();
  });

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

  test('the note carries the byline of whoever wrote it', async ({ page, login }) => {
    await openProperties(page, login);
    const card = page.locator('.list-card').first();
    const title = (await card.getByRole('heading').textContent()).trim();

    await card.locator('[title="Flag"]').click();
    const flag = page.getByRole('dialog', { name: 'Flag listing' });
    await flag.getByRole('textbox').first().fill('Duplicate of an earlier post');
    await writeNote(page, flag, 'Same photos as the Baner listing from last week.');
    await flag.getByRole('button', { name: 'Flag listing', exact: true }).click();
    await expect(page.getByText('Listing flagged', { exact: true })).toBeVisible();

    /* A byline is the part a scratchpad in one browser could not honestly have. Whether a *second*
       account can read it is the question this item was really about, and it is not a question this
       file can answer — one localStorage database serves every login here. `live-notes.spec.js`
       asks it properly, against two real sessions and one table. */
    const history = await openNoteHistory(page, title);
    await history.getByRole('button', { name: /previous note/ }).click();
    const note = history.getByText('Same photos as the Baner listing from last week.');
    await expect(note).toBeVisible();
    await expect(history.getByText(/Admin|Staff/).first()).toBeVisible();
  });
});

test.describe('Notes on the communication log', () => {
  test('a note lands on the timeline that had a style for it and no source', async ({ page, login }) => {
    await login.asAdmin();

    /* The review modal is reached by deep link rather than through the queue, because every
       decision that files a note also moves the listing off the queue it was sitting in. The link
       resolves against the whole catalogue, so the same case file reopens either way. */
    await page.goto('/admin/properties?review=PRC001');
    await expect(page.getByRole('heading', { name: 'Verify property' })).toBeVisible();

    const modal = page.getByRole('dialog');
    await writeNote(page, modal, 'Rang the owner; the rent excludes maintenance.');
    /* Approving with checklist items still unticked raises a `window.confirm`, which Playwright
       dismisses by default — which would silently abort the decision and leave this test asserting
       nothing. Say yes: the checklist is not what is under test here. */
    page.once('dialog', (d) => d.accept());
    await modal.getByRole('button', { name: /Approve & publish/ }).click();
    await expect(page.getByText(/Approved & published/)).toBeVisible();

    await page.goto('/admin/properties?review=PRC001');
    await expect(page.getByRole('heading', { name: 'Verify property' })).toBeVisible();

    /* `CommunicationLog` has had an indigo `note` style since it was written, with nothing
       producing one. The chaser ledger and the notes are the same question — what has already been
       done about this listing — and reading them in two panels made the operator interleave them
       by eye. */
    const log = page.getByRole('button', { name: /Communication log/ });
    await expect(log).toBeVisible();
    await log.click();
    const entry = page.getByTestId('comms-entry').filter({ hasText: 'Rang the owner' });
    await expect(entry).toHaveCount(1);
    await expect(entry.getByTestId('comms-entry-detail')).toHaveText('Rang the owner; the rent excludes maintenance.');
    // The byline the outreach rows cannot carry: the notes route resolves the author server-side.
    await expect(entry).toContainText('Note \u2014 Approved');
  });
});

test.describe('Notes on a person', () => {
  test('a note on an account is there when the drawer is opened again', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();

    const view = page.locator('table').locator('[title="View activity"]').first();
    await expect(view).toBeVisible();
    await view.click();

    const notes = page.getByTestId('user-notes');
    await expect(notes).toBeVisible();
    /* The empty state is worth asserting once. It used to be the *only* state: the mock read
       `db.internalNotes['user:' + id]`, a key nothing ever wrote, so every account looked clean. */
    await expect(notes.getByText(/Nobody has written a note about this account yet/)).toBeVisible();

    await notes.getByRole('textbox').fill('Second complaint about this owner this month.');
    await notes.getByRole('button', { name: 'Add note' }).click();
    await expect(notes.getByTestId('user-note')).toHaveCount(1);
    await expect(notes.getByText('Second complaint about this owner this month.')).toBeVisible();

    // Close and reopen: the panel refetches, so this is a read rather than the state it just set.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('user-notes')).toHaveCount(0);
    await view.click();
    await expect(page.getByTestId('user-note')).toHaveCount(1);
  });

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
