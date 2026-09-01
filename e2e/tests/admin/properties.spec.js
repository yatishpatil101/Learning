/* The admin properties console: tabs, filters, card actions and the four modals.
 *
 * ## What this rewrite removed, and why
 *
 * The previous version had 53 tests and 56 `waitForTimeout` calls, and a large fraction of it could
 * not fail. Three patterns accounted for almost all of it:
 *
 * 1. **Guarded assertions.** Thirteen assertions sat inside `if (await x.isVisible())` or
 *    `if (count > 0)`. Seven of those were the review-modal tests, every one of which silently
 *    no-opped whenever the verification queue was empty -- which is precisely the state in which a
 *    broken verification queue would need to be caught. The clear-flag regression test, guarding a
 *    real bug, was guarded twice: if flagging silently failed, the flagged tab had no cards, the
 *    count was 0 and the test passed. A guard around an assertion converts "the thing I came to
 *    test is missing" into "green".
 *
 * 2. **Assertions on things that were already true.** The four filter tests each acted on a control
 *    and then asserted `text=/\d+ of \d+ listings/` -- a counter that renders unconditionally, for
 *    every possible outcome, and was on screen before the click. One even carried the comment
 *    "Count should change" above an assertion that did not check whether it changed. They now
 *    capture the count first and assert the delta, plus a property of the surviving rows.
 *    `staff-posted listings show progress tracker` was worse than vacuous: it computed
 *    `hasProgress` from `isVisible().catch(() => false)` and asserted `hasProgress !== undefined`,
 *    which is `true` for every input in the language.
 *
 * 3. **Sleeps standing in for assertions.** All 56 are gone. Twenty-one were waiting for a tab
 *    switch that is a synchronous `setSearchParams`; twenty for a modal that is plain local state
 *    rendered synchronously; four for a search "debounce" that does not exist (`rowsAll` is a
 *    `useMemo`). Each is replaced by the assertion it was standing in for -- usually the one on the
 *    very next line, which retries anyway. Only the review modal is genuinely async (two round
 *    trips before `thread` is set), and `toBeVisible()` covers it properly where a fixed 2000ms did
 *    not.
 *
 * ## What it corrected
 *
 * `all 7 tabs are visible` asserted seven of the **nine** tabs that render, and `all 5 KPI cards`
 * five of the **seven**. Both were stale in the direction that cannot fail: adding a tab or a card
 * left them green. `Re-check Queue` and `Duplicates` carry a live count in the label
 * (`Duplicates (3)`), so they are matched on the stem -- an exact string would flake on data.
 *
 * ## Why this stays on the mock provider
 *
 * `AdminProperties.jsx` is hybrid. Its data path is provider-swappable, and as of D27 so is the
 * Pipeline tab — the board reads `adminPipeline` and writes through
 * `propertyService.setPipelineStage`.
 *
 * **Correction (D249).** This section used to say: *"What still holds this file on the mock is the
 * Duplicates tab and its KPI, which have no server home."* That was false twice over, and the second
 * error hid a defect.
 *
 * It is false as bookkeeping because **there are no Duplicates tests in this file**. The single one
 * is `duplicates.spec.js:42`. What this file actually contained on the subject was one parametrised
 * KPI-jump case and one `toBeVisible` in the tab-strip assertion — two client-side routing claims,
 * carrying twenty-eight tests.
 *
 * It is false as a diagnosis because "no server home" describes a control that is waiting for a
 * backend, and this one was not waiting. `main.jsx` seeds the fixture store on a live build as well
 * as a mock one, so `findDuplicateClusters` had data to chew on either way and answered with a
 * confident **0** — measured at `Duplicate listings: 0` against a live catalogue of 71 rows holding
 * four repeated titles. The tile and the tab were therefore gated out of any build serving
 * `property` over HTTP, behind a `DUPLICATES_ARE_REAL` flag in `AdminProperties.jsx`, and
 * `live-properties-console.spec.js` asserted their absence. The decision row stayed open: the
 * server might still grow a cluster read and a merge write, and if it did, both came back
 * pointed at it.
 *
 * **Correction (D255) — that is what happened, so the paragraph above is now history rather than
 * instruction.** The server grew the missing half. `GET /admin/properties/duplicates` derives the
 * clusters and `POST .../merge` resolves them; `DuplicatesTab.jsx` reads them through
 * `listDuplicateClusters` / `mergeDuplicateCluster` / `dismissDuplicateCluster`, so the tab is
 * provider-swappable like the rest of the page. **`DUPLICATES_ARE_REAL` no longer exists** — grep
 * `frontend/src` and it is gone — and `live-properties-console.spec.js` now asserts the tile and
 * the tab are *present* (`KPI_LABELS` carries `Duplicate` again, and `?tab=duplicates` is a live
 * deep-link test). Anything below that reasons from that flag is reasoning from a branch that was
 * deleted; see the correction at the end of the next section.
 *
 * So what holds this file on the mock is no longer the Duplicates tab. It is the seeded-catalogue
 * shapes — the card contents, the filter combinations, the modals, the deep links — which are
 * asserted here against listings the test itself put in the store.
 *
 * **Correction (D250).** That sentence used to end "…the deep links, the Pipeline board's stage
 * writes". The stage writes were the worst thing on the list to claim, not the best: a write is
 * exactly what a mock cannot be evidence about, because the store hands back the object the client
 * gave it, so `every pipeline card offers a stage change` and the clear-flag regression below were
 * green against a server that could have been dropping both requests on the floor. They now have
 * live counterparts — `moving a card across the pipeline board is a stage the server stores` and
 * `flagging a listing is a decision the server keeps, and clearing it publishes again` — each of
 * which acts through this same UI and then re-reads `GET /admin/properties` over a separate
 * connection. Both were mutation-proven: no-opping `flagListing` and `setPipelineStage` in the http
 * provider turned each red, while the toast and the board kept saying it had worked.
 *
 * What remains here is the *shape* of those controls — which four stages the dropdown offers, that
 * every card has one, that no listing falls off the board, that the flag modal refuses an empty
 * reason — and that is a fair mock claim, because it is a claim about the client.
 *
 * ## What `admin/live-properties-console.spec.js` now proves better than this file does
 *
 * That spec asserts the same shell against the live API, and in two places asserts something this
 * one structurally cannot: the KPI numbers and the row counter are checked against an independent
 * `GET /admin/properties`, where here they are compared to the store the page had just read — true
 * whatever the server thinks. These seven are therefore **redundant, and the reason previously given
 * for keeping them — that deleting them "would leave the Duplicates tests stranded in a file with no
 * context" — was not a reason, because those tests are in `duplicates.spec.js`**: `loads without JS
 * errors`, `shows PageHeader with title and subtitle`, `Export CSV downloads a file named for the
 * active tab`, `all seven KPI cards render`, six of the seven parametrised KPI jumps, `the strip is
 * exactly the nine supply tabs…`, and `switching tabs moves the selection rather than adding to it`.
 * They are kept for one narrower reason instead: in mock mode the strip still has nine tabs and the
 * grid still has seven cards, so these are the only tests that pin the *un-gated* shape of the page,
 * and deleting them would leave nothing watching the branch `DUPLICATES_ARE_REAL` selects when it is
 * false. That is a smaller claim than the one they used to carry, and it should be re-read the next
 * time this file is opened.
 *
 * **Correction (D255) — re-read, as instructed, and the narrower reason has expired too.** There is
 * no longer an un-gated shape to pin, because there is no gate: `DUPLICATES_ARE_REAL` was deleted
 * when the server grew the duplicates endpoints, and both modes now render the same nine tabs and
 * the same seven tiles. The live spec asserts that shape against a real `GET /admin/properties`;
 * this file asserts it against a store the page itself just wrote. **These seven are now redundant
 * with no reason left to keep them, and are the next retirement candidates in this file** — listed
 * here rather than deleted in passing, because retiring a test is a claim that something else
 * covers it, and that claim belongs in a change that can be reviewed on its own.
 *
 * **Closed 2026-08-27.** Six of the seven are gone; the seventh was not redundant after all, and
 * checking rather than assuming is the only reason it survived. `live-properties-console.spec.js:390`
 * clicks all seven tiles **in one loop with no return to a neutral tab between them**, and `Total`
 * and `Active` both land on All Listings — so by the time the loop reaches `Active` the tab is
 * already selected and the URL already reads `?tab=all`. Both of its assertions pass without the
 * click doing anything, and would go on passing if the tile were wired to nothing. It is the one
 * jump the live spec cannot fail on, so it is the one that stayed here, where the move to Pipeline
 * first makes it a real transition. The other six are proven live on both the tab and the `?tab=`,
 * which is one assertion more than this file ever made.
 *
 * **Correction.** This list used to open with *"every `logAudit` line this console writes"*. Those
 * lines are gone: every moderation call on this page goes to the server, and the server records its
 * own audit row from the authenticated principal, so the browser's copy was a duplicate of a record
 * it could not read back. Nothing here asserted on it, which is how it stayed unnoticed.
 *
 * The Pipeline entry used to be listed here as a genuine conflict — the server's `pipeline_stage`
 * was the post-on-behalf onboarding funnel while this console's was a moderation funnel of the same
 * name. V92 settled it by splitting the column rather than picking a winner, and by finding that
 * the two values the console had which the server did not (`under_review`, `live`) were `status`
 * under another name. The board derives those two columns now and stores nothing for them.
 *
 * Fixtures: `login.asAdmin()`.
 */
import { test, expect } from '../../fixtures/base.js';

/* `TABS`, `KPIS` and `COUNTER` went with the tests that read them — the tab strip, the KPI row and
   the All Listings counter are all asserted against a real server in `live-properties-console.spec.js`
   now. `STAGES` stays: the pipeline board is still checked here. */
/** The six board columns. Only the first four are stored; the last two are `status` read sideways. */
const STAGES = ['Contacted', 'Info Collected', 'Listed', 'Docs Submitted', 'Under Review', 'Live'];
/** `PAGE_LIMIT` in `properties/constants.js` -- the list renders at most this many cards. */
const PAGE_LIMIT = 15;

/** Signed in as admin, on the console, with the listings actually rendered. */
async function openProperties(page, login, path = '/admin/properties') {
  await login.asAdmin();
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
  await expect(page.locator('.list-card').first()).toBeVisible();
}

/** Click a tab and wait for it to actually be the selected one. Replaces 21 fixed sleeps. */
async function openTab(page, label) {
  const tab = page.getByRole('tab', { name: label });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  return tab;
}

/* `pickSelectOption`, `settledCount` and `openFirstReview` were retired with their callers.

   `settledCount` is worth a line of its own, because it is not simply gone. It existed because
   status and deal became server axes and the counter kept showing the previous query's number
   until the response landed — which is how "approved is fewer than the total" once came to compare
   84 against 84. The live filter test does not reproduce it: it asserts through
   `expect(cards(page)).toHaveCount(n)`, and a web-first assertion retries until the count is what
   was claimed, so the stale paint is waited out by the assertion itself rather than by a helper
   reading the number twice. Nothing was lost in the move; the polling was doing by hand what the
   live spec gets from asserting on the DOM instead of on a scraped integer. */

// ═══════════════════════════════════════════════════════
// ─── PAGE LOAD & STRUCTURE ───
// ═══════════════════════════════════════════════════════

/* `Properties page structure` — the whole describe is retired; see
   `live-properties-console.spec.js`.

   Three tests were deleted here on 2026-08-25 — `loads without JS errors`,
     `shows PageHeader with title and subtitle` and
     `Export CSV downloads a file named for the active tab`. All three are made verbatim against a
     real server in `live-properties-console.spec.js`: the first two at :324, the export at :741
     over the same four tab/filename pairs.

     The console sweep is the one worth a note, because the live version is not merely a copy — it
     filters the catalogue-truncation notice through `realErrors()`. That notice is a deliberate
     `console.error` the app raises when a result set overflows the page it was fetched in, and it
     cannot fire here at all, because the mock provider has no page ceiling. This test was therefore
     structurally incapable of seeing the one condition it would have been most useful for. */

// ═══════════════════════════════════════════════════════
// ─── KPI CARDS ───
// ═══════════════════════════════════════════════════════

test.describe('KPI cards', () => {
  /* `all seven KPI cards render` was deleted here on 2026-08-25.
     `live-properties-console.spec.js:390` asserts the same seven labels and then clicks each one
     and checks the tab it selects, so it is strictly the stronger of the two. What it does not
     replace is the *values* those tiles carry — that is a server-count claim, and it is owned live
     at :446 against `GET /admin/properties/summary`. */

  /* Six of the seven KPI jumps were retired on 2026-08-27, closing out the D255 correction above.
     `live-properties-console.spec.js:390` walks Total, Pending, Flagged, Re-check, Featured and
     Duplicate, asserting both the selected tab and the resulting `?tab=` — the same claim as here
     and one assertion stronger, against a real catalogue.

     `Active` is the exception, and it is the reason this block still exists rather than being
     deleted whole. The live loop clicks the seven tiles **without returning to a neutral tab
     between them**, and `Total` and `Active` both land on All Listings. So by the time it reaches
     `Active` the tab is already selected and the URL already carries `?tab=all` — both assertions
     pass without the click doing anything, and would keep passing if the Active tile were wired to
     nothing at all. Every other label changes the tab, so every other case is a real transition
     there.

     Here the jump is preceded by a move to Pipeline, which is what makes "jumped" distinguishable
     from "was already there". That is a claim about the client's tab routing, it needs no server,
     and it is currently made nowhere else. */
  test('the Active KPI jumps to its tab', async ({ page, login }) => {
    await openProperties(page, login);
    // Start somewhere else, so "jumped" is distinguishable from "was already there".
    await openTab(page, 'Pipeline');
    await page.getByTitle('View Active listings').click();
    await expect(page.getByRole('tab', { name: 'All Listings' })).toHaveAttribute('aria-selected', 'true');
  });
});

// ═══════════════════════════════════════════════════════
// ─── TAB NAVIGATION ───
// ═══════════════════════════════════════════════════════

/* `Tab navigation` — the whole describe is retired; see `live-properties-console.spec.js`.

   Both tests here were deleted on 2026-08-25 — `the strip is exactly the nine supply tabs, and
   All Listings is the default` and `switching tabs moves the selection rather than adding to it`.
   They are made assertion-for-assertion in `live-properties-console.spec.js` at :339 and :361,
   including the count of nine, the two stem-matched labels and the negative half of the move. */

// ═══════════════════════════════════════════════════════
// ─── ALL LISTINGS TAB ───
// ═══════════════════════════════════════════════════════

/* `All Listings tab` — the whole describe is retired; see `live-properties-console.spec.js`.

   Four tests were deleted here on 2026-08-25 — `cards carry the listing title and locality, and
     the counter agrees with them`, `search narrows the list to rows that match`,
     `an unmatchable search empties the list` and
     `the status, deal and date filters each change the result`.

     Their live counterparts are `live-properties-console.spec.js` :446, :523 and :566, and three of
     the four carried assertions the live versions were missing. Those were ported across *before*
     this deletion rather than after, which is the only order in which a cull is not a coverage cut:

       - the exact rendered-card count when the match set is below the fifteen-row cap, plus a
         non-empty heading and the server's own locality on the card (→ :446);
       - a search by locality with every surviving card required to contain the term — the only leg
         that can catch a box which ignores the query and returns the unfiltered page, since a
         search for a freshly minted unique tag looks identical either way (→ :523);
       - the row being *restored* when the status filter is reset to `All statuses`, which catches a
         reset that leaves the previous filter latched behind a control that reads clear (→ :566).

     What deliberately did not carry over: these tests read their expectations off the counter the
     page had already rendered (`shown`, `total`, `before`) and compared the page to itself. The
     live versions take theirs from `GET /admin/properties/summary`, which is why they can fail on a
     catalogue bigger than one page and these could not. */

// ═══════════════════════════════════════════════════════
// ─── VERIFICATION QUEUE ───
// ═══════════════════════════════════════════════════════

/* `Verification Queue` — the whole describe is retired; see `live-properties-console.spec.js`.

   Three tests were deleted here on 2026-08-25 — `the review modal carries everything an approval
     decision needs`, `the WhatsApp templates appear when the owner has a number to send to` and
     `closing the review modal removes it`. They live at `live-properties-console.spec.js:604` and
     `live-outreach-console.spec.js`'s `openWhatsappPanel` gateway.

     Two assertions were ported before the deletion, because the live versions did not have them:

       - the `N pending` counter asserted in *both* directions — absent on All Listings, present on
         the Verification Queue. Only the second half is usually written, and on its own it is
         satisfied by a counter that renders on every tab, which tells a moderator there is work
         waiting no matter which desk they are standing at (→ live-properties-console:604).
       - an owner number actually on screen in the case file. `WhatsappTemplates` renders only when
         `review.ownerMobile` is set, so the panel's presence is *evidence* of a number rather than
         a check on one — the day that field stops mapping, the panel still opens and every template
         in it is a message with no addressee (→ live-outreach-console, `openWhatsappPanel`).

     The live review-modal test is otherwise the stronger of the two: it narrows to a listing it
     created itself rather than opening whatever case file happens to be first on a shared queue,
     which this version could not avoid doing. */

// ═══════════════════════════════════════════════════════
// ─── NEEDS FOLLOW-UP TAB ───
// ═══════════════════════════════════════════════════════

test.describe('Needs Follow-up tab', () => {
  test('lists the follow-ups and offers the reason sub-filter', async ({ page, login }) => {
    await openProperties(page, login);
    await openTab(page, 'Needs Follow-up');
    await expect(page.getByText(/\d+ listings/)).toBeVisible();

    const trigger = page.getByRole('button', { name: 'Filter by reason' });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    for (const reason of ['All reasons', 'Stale pending', 'Awaiting owner', 'Unconfirmed (stale)']) {
      await expect(page.locator('.pn-dropdown__option', { hasText: reason })).toBeVisible();
    }
  });

  /* The `Unconfirmed (stale)` sub-filter -- the one that turns on `reminderAlways` and so is the
     only reliable way to reach the WhatsApp chase -- is deliberately NOT tested here.
     `rowsUnconfirmed` requires `real && !archived && status === 'approved'` and a `freshnessState`
     of stale or dormant, which the default seed does not dependably contain; a test written against
     it here passes or fails on what happens to be in the demo data. `admin/listing-freshness.spec.js`
     owns that case and seeds `Unconfirmed Stale Flat` with an explicit `freshenedAt` first, which is
     the only way to assert it and mean it. Duplicating it here with a weaker fixture would add a
     flake, not coverage. */
});

// ═══════════════════════════════════════════════════════
// ─── STAFF POSTED / FLAGGED / FEATURED ───
// ═══════════════════════════════════════════════════════

test.describe('Supply tabs', () => {
  test('staff-posted cards show the concierge progress tracker', async ({ page, login }) => {
    await openProperties(page, login);
    await openTab(page, 'Staff Posted');
    await expect(page.getByText(/\d+ staff-posted/)).toBeVisible();

    /* Replaces a test whose only assertion was `expect(hasProgress !== undefined).toBeTruthy()` --
       `hasProgress` came from `isVisible().catch(() => false)`, so it was a boolean either way and
       the expression was true for every input. The tracker is five named steps and a counter; that
       is what the test should have been saying. */
    const card = page.locator('.list-card').first();
    await expect(card).toBeVisible();
    await expect(card.getByText('Link Sent')).toBeVisible();
    await expect(card.getByText('Aadhaar')).toBeVisible();
    await expect(card.getByText(/^[0-5]\/5$/)).toBeVisible();
  });

  test('each supply tab renders its own count label and its own card action', async ({ page, login }) => {
    await openProperties(page, login);

    await openTab(page, 'Flagged');
    await expect(page.getByText(/\d+ flagged/)).toBeVisible();
    // De-guarded: a flagged tab with no cards is a failure, not a skip.
    await expect(page.locator('.list-card')).not.toHaveCount(0);
    await expect(page.getByTitle('Clear flag & publish').first()).toBeVisible();

    await openTab(page, 'Featured');
    await expect(page.getByText(/\d+ featured/)).toBeVisible();
    await expect(page.locator('.list-card')).not.toHaveCount(0);
    await expect(page.getByTitle('Unfeature').first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// ─── PIPELINE TAB ───
// ═══════════════════════════════════════════════════════

test.describe('Pipeline tab', () => {
  test('shows the six stage columns and a total', async ({ page, login }) => {
    await openProperties(page, login);
    await openTab(page, 'Pipeline');
    for (const stage of STAGES) {
      // exact: true rather than a `.rounded-full` hasText substring -- the old selector worked only
      // because this tab happens to render no other pill, and "Listed" is a substring of nothing
      // here purely by luck.
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(/\d+ total/)).toBeVisible();
  });

  test('every pipeline card offers a stage change', async ({ page, login }) => {
    await openProperties(page, login);
    await openTab(page, 'Pipeline');
    await expect(page.locator('[aria-label^="Change pipeline stage"]').first()).toBeVisible();
    const cards = await page.locator('[aria-label^="Change pipeline stage"]').count();
    expect(cards).toBeGreaterThan(0);
  });

  /* The board files every listing it shows, and shows every listing it has (D27).
     The previous version invented a stage for anything with a null one and then dropped the row
     entirely if the invented value was not a known column key -- so a listing carrying an
     unrecognised stage silently vanished off the board. Nothing on screen said a row was missing,
     which is the failure mode this asserts against: the column counts must add up to the total the
     header reports. */
  test('no listing falls off the board', async ({ page, login }) => {
    await openProperties(page, login);
    await openTab(page, 'Pipeline');

    const total = Number((await page.getByText(/\d+ total/).innerText()).match(/\d+/)[0]);
    expect(total).toBeGreaterThan(0);

    let summed = 0;
    for (const stage of STAGES) {
      // The count sits in the column header, next to the stage pill.
      const header = page.locator('.rounded-xl', { has: page.getByText(stage, { exact: true }) }).first();
      summed += Number((await header.locator('.tabular-nums').first().innerText()).trim());
    }
    /* `total` counts unarchived listings; the columns additionally exclude rejected ones, so the
       columns may hold fewer -- but never more, and never zero while listings exist. What would
       fail here is the old drop: a stage the board did not recognise took its listing with it. */
    expect(summed).toBeGreaterThan(0);
    expect(summed).toBeLessThanOrEqual(total);
  });

  /* `Under Review` and `Live` are not stored stages -- they are `status` read sideways, which is why
     the stage dropdown does not offer them. Offering them was the bug: the console wrote values the
     server's enum never contained, so approving a listing and "moving it to Live" were two ways to
     say the same thing that could disagree. */
  test('the stage dropdown offers only the four the desk can set', async ({ page, login }) => {
    await openProperties(page, login);
    await openTab(page, 'Pipeline');

    await page.locator('[aria-label^="Change pipeline stage"]').first().click();
    const menu = page.getByRole('listbox');
    await expect(menu).toBeVisible();

    for (const settable of ['Contacted', 'Info Collected', 'Listed', 'Docs Submitted']) {
      await expect(menu.getByText(settable, { exact: true })).toBeVisible();
    }
    for (const derived of ['Under Review', 'Live']) {
      await expect(menu.getByText(derived, { exact: true })).toHaveCount(0);
    }
  });
});

// ═══════════════════════════════════════════════════════
// ─── CARD ACTION MODALS ───
// ═══════════════════════════════════════════════════════

test.describe('Card action modals', () => {
  /* `the edit modal opens prefilled and cancel closes it` was retired here on 2026-08-25, split in
     two and rewritten live in `admin/live-properties-moderation.spec.js`.

     The prefill half is `a moderator can correct a BHK on a listing they do not own`, which seeds
     from the stored integer, saves, and reads the new value back from the API rather than off the
     screen the write just re-rendered.

     The cancel half is `cancelling the edit modal discards the change rather than quietly saving
     it`, and it is the one that changed shape. This version asserted that the dialog was gone --
     the only thing it *could* assert, since the mock provider's `updateListingFields` is
     `Object.assign(listing, patch)` over a localStorage record, so the store that would have to
     report the unwanted write is the same object the test reads its "before" from. A modal that
     saved on Cancel closes exactly like one that does not, and this test would have passed on it.
     Live, the listing is read back from the API and must still carry the old number. */

  test('the flag modal refuses to submit without a reason', async ({ page, login }) => {
    await openProperties(page, login);
    await page.locator('[title="Flag"]').first().click();
    await expect(page.getByRole('heading', { name: 'Flag listing' })).toBeVisible();
    await expect(page.getByText('Internal note (optional)')).toBeVisible();

    /* exact: true because the modal is *titled* "Flag listing", so its dismiss icon is
       aria-labelled "Close Flag listing" and a loose match would hit both. */
    await page.getByRole('button', { name: 'Flag listing', exact: true }).click();
    await expect(page.getByText('Add a reason before flagging')).toBeVisible();
    // The modal is still open -- a refused submit must not also dismiss the form.
    await expect(page.getByRole('dialog', { name: 'Flag listing' })).toBeVisible();
  });

  test('the archive modal explains what archiving does', async ({ page, login }) => {
    await openProperties(page, login);
    await page.locator('[title="Archive"]').first().click();
    const modal = page.getByRole('dialog', { name: 'Archive listing' });
    await expect(modal.getByRole('heading', { name: 'Archive listing' })).toBeVisible();
    await expect(modal.getByText(/Archiving hides the listing/i)).toBeVisible();
    /* Scoped to the dialog, and by role rather than `.pn-btn-danger` hasText. Every card behind the
       modal carries a `title="Archive"` icon button, and `title` feeds the accessible name -- so an
       unscoped `getByRole('button', { name: 'Archive' })` matches all fifteen of them plus the
       footer. The class-based selector it replaces dodged that by accident, and would in turn have
       matched the bulk bar's "Archive selected" had any row been ticked. */
    await expect(modal.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
  });

  test('the view modal shows the listing detail', async ({ page, login }) => {
    await openProperties(page, login);
    await page.locator('[title="View"]').first().click();
    await expect(page.getByRole('heading', { name: 'Listing details' })).toBeVisible();
    await expect(page.getByText('Listing ID')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════
// ─── DEEP LINKS ───
// ═══════════════════════════════════════════════════════

test.describe('Deep links', () => {
  for (const [query, tab] of [['tab=verify', 'Verification Queue'], ['tab=pipeline', 'Pipeline']]) {
    test(`?${query} opens that tab directly`, async ({ page, login }) => {
      await login.asAdmin();
      await page.goto(`/admin/properties?${query}`);
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    });
  }

  /* `?review=<id> opens the review modal directly` was retired here on 2026-08-25.

     It is the same assertion live, on a real listing: `admin/live-notes.spec.js` deep-links
     `/admin/properties?review=${id}` and waits for the `Verify property` heading -- twice, once
     before a decision and once on a fresh page afterwards, because that spec needs the modal to
     survive the listing moving between queues. The id there is a uuid the test minted, where this
     one hard-coded `PRC001`, a mock-store id no server has ever issued; the modal's two round trips
     that the comment here was about are real round trips there.

     Nothing was lost by deleting it, and one thing was gained: this version could not have failed
     if the deep link resolved against the browser's own copy of the catalogue, which is precisely
     what it did. */
});

// ═══════════════════════════════════════════════════════
// ─── BUG REGRESSION: CLEAR FLAG ACTION ───
// ═══════════════════════════════════════════════════════

test.describe('Clear flag regression', () => {
  test('a listing flagged here appears on the Flagged tab with a clear-flag action', async ({ page, login }) => {
    await openProperties(page, login);

    /* This is the regression test for a real bug, and in its previous form it was the least able to
       catch it: the flag was applied inside `if (await flagBtn.isVisible())` and the assertion sat
       inside `if (count > 0)`, so a silent failure to flag left the tab empty and the test green.
       Both guards are gone, and the flow now asserts each step: the toast confirms the write, and
       the tab must actually have gained the card. */
    const flagged = await page.locator('.list-card').first().getByRole('heading').textContent();

    await page.locator('[title="Flag"]').first().click();
    await expect(page.getByRole('heading', { name: 'Flag listing' })).toBeVisible();
    await page.locator('textarea').first().fill('Test flag for automation');
    await page.getByRole('button', { name: 'Flag listing', exact: true }).click();
    await expect(page.getByText('Listing flagged')).toBeVisible();

    await openTab(page, 'Flagged');
    await expect(page.locator('.list-card')).not.toHaveCount(0);
    // The listing we flagged is the one that arrived, not merely some listing.
    const card = page.locator('.list-card', { hasText: flagged.trim() });
    await expect(card).toBeVisible();
    await expect(card.getByTitle('Clear flag & publish')).toBeVisible();
  });
});
