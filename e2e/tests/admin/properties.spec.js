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
 * `propertyService.setPipelineStage`. What still holds this file on the mock is the Duplicates tab
 * and its KPI, which have no server home. Recorded in `tasks/todo.md`, and now as a decision row in
 * `tasks/DECISIONS-NEEDED.md`: `findDuplicateClusters` runs union-find over the browser store and
 * "merge" archives into `localStorage`, so an operator who merges a cross-owner duplicate today
 * changes nothing anyone else can see. Either the server grows a cluster read and a merge write, or
 * the tab comes out.
 *
 * ## What `admin/live-properties-console.spec.js` now proves better than this file does
 *
 * That spec asserts the same shell against the live API, and in two places asserts something this
 * one structurally cannot: the KPI numbers and the row counter are checked against an independent
 * `GET /admin/properties`, where here they are compared to the store the page had just read — true
 * whatever the server thinks. These seven are therefore **redundant, kept only because deleting
 * them would leave the Duplicates tests stranded in a file with no context**: `loads without JS
 * errors`, `shows PageHeader with title and subtitle`, `Export CSV downloads a file named for the
 * active tab`, `all seven KPI cards render`, six of the seven parametrised KPI jumps (**not**
 * `the Duplicate KPI jumps to its tab`), `the strip is exactly the nine supply tabs…`, and
 * `switching tabs moves the selection rather than adding to it`. When the Duplicates decision
 * lands, this file collapses to whatever that decision leaves behind.
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

/** Every tab the strip renders. The last two carry a live count, so they are matched on the stem. */
const TABS = ['All Listings', 'Verification Queue', 'Needs Follow-up', 'Staff Posted', 'Flagged', 'Featured', 'Pipeline'];
/** KPI cards, in render order. Each is a shortcut into a tab. */
const KPIS = ['Total', 'Active', 'Pending', 'Flagged', 'Re-check', 'Duplicate', 'Featured'];
/** The six board columns. Only the first four are stored; the last two are `status` read sideways. */
const STAGES = ['Contacted', 'Info Collected', 'Listed', 'Docs Submitted', 'Under Review', 'Live'];
/** `{rows.length} of {all.length} listings`, the All Listings counter. */
const COUNTER = /\d+ of \d+ listings/;
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

/** Open a custom `Select` and choose an option, waiting on the component's own open/closed state. */
async function pickSelectOption(page, ariaLabel, optionText) {
  // The trigger and the portalled listbox share the aria-label, so the trigger must be addressed by
  // its role -- `[aria-label="..."]` matches both the moment the menu opens.
  const trigger = page.getByRole('button', { name: ariaLabel });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.pn-dropdown__option', { hasText: optionText }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toContainText(optionText);
}

/** Open the first listing's review modal, having first proved the queue is not empty. */
async function openFirstReview(page) {
  const tab = page.getByRole('tab', { name: 'Verification Queue' });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await openTab(page, 'Verification Queue');
  // No guard: an empty verification queue is a failure of this test, not a reason to skip it.
  const review = page.getByRole('button', { name: /^Review$/ });
  await expect(review.first()).toBeVisible();
  await review.first().click();
  await expect(page.getByRole('heading', { name: 'Verify property' })).toBeVisible();
}

// ═══════════════════════════════════════════════════════
// ─── PAGE LOAD & STRUCTURE ───
// ═══════════════════════════════════════════════════════

test.describe('Properties page structure', () => {
  test('loads without JS errors', async ({ page, login, consoleErrors }) => {
    await openProperties(page, login);
    expect(consoleErrors).toEqual([]);
  });

  test('shows PageHeader with title and subtitle', async ({ page, login }) => {
    await openProperties(page, login);
    // exact: true — every listing title renders in an <h3>, so a /Properties/i substring match
    // would become a strict-mode violation the day a seeded title contains the word.
    await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
    await expect(page.getByText('Manage, verify and curate every listing')).toBeVisible();
  });

  test('Export CSV downloads a file named for the active tab', async ({ page, login }) => {
    await openProperties(page, login);

    /* The old test only asserted the button was visible, which left the entire export unexercised.
       `exportCurrentCsv` branches on `activeTab` and picks a different filename *and* a different
       header set per tab, and none of that was covered. Arming `waitForEvent('download')` before
       the click is what makes the assertion about the export rather than about the button. */
    const download = async (expected) => {
      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /Export CSV/i }).click(),
      ]);
      expect(dl.suggestedFilename()).toBe(expected);
    };

    await download('punenest-listings.csv');
    await openTab(page, 'Verification Queue');
    await download('punenest-verification-queue.csv');
    await openTab(page, 'Flagged');
    await download('punenest-flagged.csv');
    await openTab(page, 'Featured');
    await download('punenest-featured.csv');
  });
});

// ═══════════════════════════════════════════════════════
// ─── KPI CARDS ───
// ═══════════════════════════════════════════════════════

test.describe('KPI cards', () => {
  test('all seven KPI cards render', async ({ page, login }) => {
    await openProperties(page, login);
    for (const label of KPIS) {
      await expect(page.getByText(`${label} listings`)).toBeVisible();
    }
  });

  // One data-driven test in place of four near-identical ones, and it covers the two shortcuts
  // (Re-check, Duplicate) that had no test at all.
  const JUMPS = [
    ['Total', 'All Listings'],
    ['Active', 'All Listings'],
    ['Pending', 'Verification Queue'],
    ['Flagged', 'Flagged'],
    ['Re-check', /^Re-check Queue/],
    ['Duplicate', /^Duplicates/],
    ['Featured', 'Featured'],
  ];
  for (const [kpi, tab] of JUMPS) {
    test(`the ${kpi} KPI jumps to its tab`, async ({ page, login }) => {
      await openProperties(page, login);
      // Start somewhere else, so "jumped" is distinguishable from "was already there".
      await openTab(page, 'Pipeline');
      await page.getByTitle(`View ${kpi} listings`).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    });
  }
});

// ═══════════════════════════════════════════════════════
// ─── TAB NAVIGATION ───
// ═══════════════════════════════════════════════════════

test.describe('Tab navigation', () => {
  test('the strip is exactly the nine supply tabs, and All Listings is the default', async ({ page, login }) => {
    await openProperties(page, login);
    // A count, so that adding a tab without a test fails here rather than passing silently.
    await expect(page.getByRole('tab')).toHaveCount(9);
    for (const tab of TABS) {
      await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    }
    // These two carry a live count in the label, so they are matched on the stem.
    await expect(page.getByRole('tab', { name: /^Re-check Queue/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Duplicates/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'All Listings' })).toHaveAttribute('aria-selected', 'true');
  });

  test('switching tabs moves the selection rather than adding to it', async ({ page, login }) => {
    await openProperties(page, login);
    await openTab(page, 'Pipeline');
    // The negative half: the tab we left must actually have been deselected.
    await expect(page.getByRole('tab', { name: 'All Listings' })).toHaveAttribute('aria-selected', 'false');
    await expect(page).toHaveURL(/[?&]tab=pipeline\b/);
  });
});

// ═══════════════════════════════════════════════════════
// ─── ALL LISTINGS TAB ───
// ═══════════════════════════════════════════════════════

test.describe('All Listings tab', () => {
  test('cards carry the listing title and locality, and the counter agrees with them', async ({ page, login }) => {
    await openProperties(page, login);
    const counter = page.getByText(COUNTER);
    await expect(counter).toBeVisible();

    /* The old test was called "property cards show title and locality" and asserted only that a
       card existed. Deriving the expected number from the counter is what ties the two together --
       but the list is capped at `PAGE_LIMIT` and the counter is not, so the honest claim is that
       the page renders the whole match set *or* a full page of it, and says which. Asserting the
       counter alone would miss a list that renders nothing; asserting the cards alone would miss a
       counter that has drifted from what is on screen. */
    const shown = Number((await counter.textContent()).match(/(\d+) of/)[1]);
    await expect(page.locator('.list-card')).toHaveCount(Math.min(shown, PAGE_LIMIT));
    if (shown > PAGE_LIMIT) {
      await expect(page.getByText(`Showing ${PAGE_LIMIT} of ${shown}`)).toBeVisible();
    }
    const first = page.locator('.list-card').first();
    await expect(first.getByRole('heading')).not.toBeEmpty();
  });

  test('search narrows the list to rows that match', async ({ page, login }) => {
    await openProperties(page, login);
    const counter = page.getByText(COUNTER);
    const before = await counter.textContent();

    // Take the term from a row that exists, so an empty result is a real failure and not a
    // property of the seed.
    const locality = 'Baner';
    await page.getByPlaceholder('Search title, owner, locality').first().fill(locality);

    // The assertion the original was missing entirely: the count actually moved.
    await expect(counter).not.toHaveText(before);
    const cards = page.locator('.list-card');
    await expect(cards).not.toHaveCount(0);
    for (const card of await cards.all()) {
      await expect(card).toContainText(new RegExp(locality, 'i'));
    }
  });

  test('an unmatchable search empties the list', async ({ page, login }) => {
    await openProperties(page, login);
    await page.getByPlaceholder('Search title, owner, locality').first().fill('zzzz-no-such-listing-zzzz');
    // The other half of the pair: the filter is only proved to work if it can also exclude
    // everything. Paired with the test above, which proves it does not exclude too much.
    await expect(page.locator('.list-card')).toHaveCount(0);
    await expect(page.getByText(/^0 of \d+ listings/)).toBeVisible();
  });

  test('the status, deal and date filters each change the result', async ({ page, login }) => {
    await openProperties(page, login);
    const counter = page.getByText(COUNTER);
    const total = Number((await counter.textContent()).match(/of (\d+)/)[1]);

    await pickSelectOption(page, 'Filter by status', 'Approved');
    const approved = Number((await counter.textContent()).match(/(\d+) of/)[1]);
    expect(approved).toBeLessThan(total);
    // Every surviving card is approved -- the filter excludes the right rows, not merely some.
    for (const card of await page.locator('.list-card').all()) {
      await expect(card).not.toContainText('Pending');
    }

    await pickSelectOption(page, 'Filter by status', 'All statuses');
    await expect(counter).toHaveText(new RegExp(`${total} of ${total} listings`));

    await page.getByRole('button', { name: 'Rent' }).first().click();
    const rent = Number((await counter.textContent()).match(/(\d+) of/)[1]);
    expect(rent).toBeLessThanOrEqual(total);
    expect(rent).toBeGreaterThan(0);

    await page.getByRole('button', { name: '7d' }).first().click();
    const week = Number((await counter.textContent()).match(/(\d+) of/)[1]);
    expect(week).toBeLessThanOrEqual(rent);
  });
});

// ═══════════════════════════════════════════════════════
// ─── VERIFICATION QUEUE ───
// ═══════════════════════════════════════════════════════

test.describe('Verification Queue', () => {
  test('the review modal carries everything an approval decision needs', async ({ page, login }) => {
    await openProperties(page, login);
    // The pending count belongs to the verification queue, so it is absent until we get there --
    // asserted in both directions, because "visible on the right tab" is only half the claim.
    await expect(page.getByText(/\d+ pending/)).toHaveCount(0);
    await openTab(page, 'Verification Queue');
    await expect(page.getByText(/\d+ pending/)).toBeVisible();
    await openFirstReview(page);

    /* Seven separate tests used to open this modal, each paying for a login, a page load, a tab
       switch and a 800ms sleep to assert one string, and each wrapped in the same
       `if (await reviewBtn.isVisible())`. They are one test because they are one claim: the case
       file is complete. */

    // "N / M checked", not "N / M verified". The section used to be a document list with a
    // verified/rejected pair per row, which wrote three states into a boolean column -- so
    // `rejected` and "not looked at yet" were the same answer to the only question an approval
    // asks, which is whether every line is ticked. It is now one toggle per line, and the count
    // says what it counts.
    await expect(page.getByText('Verification checklist')).toBeVisible();
    await expect(page.getByText(/\d+ \/ \d+ checked/)).toBeVisible();

    await expect(page.getByRole('button', { name: /Approve & publish/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Reject…/i })).toBeVisible();
    await expect(page.getByText('Communicate with the owner')).toBeVisible();
    await expect(page.getByText('Property details')).toBeVisible();
    await expect(page.getByText('Listing ID')).toBeVisible();
  });

  test('the WhatsApp templates appear when the owner has a number to send to', async ({ page, login }) => {
    await openProperties(page, login);
    await openFirstReview(page);

    /* `WhatsappTemplates` is rendered only when `review.ownerMobile` is set. The old test asserted
       it unconditionally from inside a visibility guard, so it passed both when the section
       rendered and when the whole modal never opened. Asserting the precondition first makes the
       two outcomes distinguishable: if this listing has no owner number, the *precondition* fails
       and says so, rather than the section quietly not being checked. */
    const modal = page.getByRole('dialog', { name: 'Verify property' });
    await expect(modal.getByText(/^[0-9•+ ]{6,}$/).first()).toBeVisible();
    await expect(page.getByText('WhatsApp templates')).toBeVisible();
  });

  test('closing the review modal removes it', async ({ page, login }) => {
    await openProperties(page, login);
    await openFirstReview(page);
    /* exact: true — Modal renders its dismiss icon as `aria-label="Close {title}"`, so a loose
       'Close' also matches "Close Verify property". Both are legitimate; the footer button is the
       one this test means. */
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    // Modal returns null when closed, so count is a stronger claim than not-visible.
    await expect(page.getByRole('dialog', { name: 'Verify property' })).toHaveCount(0);
  });
});

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
  test('the edit modal opens prefilled and cancel closes it', async ({ page, login }) => {
    await openProperties(page, login);
    const title = await page.locator('.list-card').first().getByRole('heading').textContent();

    await page.locator('[title="Edit"]').first().click();
    await expect(page.getByRole('heading', { name: 'Edit listing' })).toBeVisible();

    // The old test asserted the *labels* ("Title", "Price", "Locality") were on screen, which says
    // nothing about whether the modal is editing the listing you clicked. The value does.
    await expect(page.getByRole('dialog', { name: 'Edit listing' }).getByRole('textbox').first()).toHaveValue(title.trim());
    await expect(page.getByRole('button', { name: /Save changes/i })).toBeVisible();

    await page.getByRole('button', { name: /Cancel/i }).click();
    await expect(page.getByRole('dialog', { name: 'Edit listing' })).toHaveCount(0);
  });

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

  test('?review=PRC001 opens the review modal directly', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/properties?tab=verify&review=PRC001');
    // The review modal needs two round trips before `thread` is set and `if (!review || !thread)
    // return null` clears. `toBeVisible()` retries across both; the fixed 2000ms it replaced did
    // not, and was the reason this test was flaky.
    await expect(page.getByRole('heading', { name: 'Verify property' })).toBeVisible();
  });
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
