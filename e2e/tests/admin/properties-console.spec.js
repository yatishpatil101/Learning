import { expect, test, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';
import { appReady } from '../../helpers/app.js';

// Counters are recomputed from the page's own `GET /api/admin/properties` payload: on a shared
// live catalogue no magnitude is stable, so the rendered body is the only honest baseline.

// Only the first `PAGE_LIMIT` rows of a filtered set render, so every card assertion below first
// narrows by search - "not on screen" and "on page two" are otherwise the same pixels.
const PAGE_LIMIT = 15;

/** The strip, in render order, from `tabItems`. Two of the nine carry a count when it is non-zero. */
const TABS = [
  /^All Listings$/,
  /^Verification Queue$/,
  /^Needs Follow-up$/,
  /^Staff Posted$/,
  /^Flagged$/,
  /^Re-check Queue( \(\d+\))?$/,
  /^Featured$/,
  /^Duplicates( \(\d+\))?$/,
  /^Pipeline$/,
];

/** `KpiCard` renders `title={`View ${label} listings`}`, which is the only stable handle on a tile. */
const KPI_LABELS = ['Total', 'Active', 'Pending', 'Flagged', 'Re-check', 'Featured', 'Duplicate'];

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
  // A real entry in `GET /localities`, so the resolver files the listing rather than leaving
  // `locality_slug` null and dropping it into the curation queue `live-locality-queue` owns.
  locality: 'Baner',
};

/*
 * `warnIfTruncated` fires through `console.error` whenever the shared live catalogue outgrows the
 * `size=100` fetch - a fact about the database, not the console, so it must not fail no-error runs.
 */
const CATALOGUE_TRUNCATED = /^\[property\] \d+ listings matched but only \d+ were fetched/;
const realErrors = (errors) => errors.filter((e) => !CATALOGUE_TRUNCATED.test(e));

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/* Every uuid this file has put into the shared catalogue, drained by `afterEach`. A module-level
   set is safe because the live config runs `workers: 1`. */
const created = new Set();

/**
 * Created through the owner's own route, not an admin write, so "pending" is the state the *server*
 * assigns - every verification-queue assertion below rests on that.
 */
async function pendingListing(tag) {
  const title = `Zztest console ${tag}`;
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/listings', headers, { ...BASE_LISTING, title });
  expect(res.status).toBe(201);
  created.add(res.body.id);
  return { id: res.body.id, label: res.body.slug || res.body.id, title, tag };
}

/**
 * Rejection rather than deletion, because the platform has no delete: a rejected listing leaves the
 * verification queue and the public site, which is the state a shared queue needs it in.
 */
test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic console fixture',
    });
  }
  created.clear();
});

/**
 * Matches positively on the exact path plus paging-only params, so any facet added later drops out
 * of scope on its own - an exclusion list kept losing races against sibling fetches on mount.
 */
const LIST_PAGING_PARAMS = ['sort', 'page', 'size'];
function isAllListingsFetch(res) {
  if (res.request().method() !== 'GET') return false;
  let url;
  try {
    url = new URL(res.url());
  } catch {
    return false;
  }
  // Exact path, so `/summary` and `/duplicates` are out by construction rather than by exclusion.
  if (!url.pathname.endsWith('/api/admin/properties')) return false;
  return [...url.searchParams.keys()].every((k) => LIST_PAGING_PARAMS.includes(k));
}

async function openConsole(page, search = '') {
  await page.goto(`/admin/properties${search}`, { waitUntil: 'commit' });
  const [res, summaryRes] = await Promise.all([
    page.waitForResponse(isAllListingsFetch),    /* The bytes the KPI strip renders from, captured rather than re-fetched: a second read of a
       database three other specs write to would surface legitimate drift as "a tile is wrong". */
    page.waitForResponse(
      (r) => r.url().includes('/api/admin/properties/summary') && r.request().method() === 'GET',
    ),
  ]);
  expect(res.status()).toBe(200);
  expect(summaryRes.status()).toBe(200);
  const payload = await res.json();
  const summary = await summaryRes.json();
  await appReady(page);
  await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
  /* Spread so `payload.content` keeps working for every existing caller, with the summary carried
     alongside for the one test that needs it. */
  return { ...payload, summary };
}

const tab = (page, name) => page.getByRole('tab', { name });
const cards = (page) => page.locator('.list-card');

/** Click a tab and wait for the selection to move, so callers never assert against the old one. */
async function openTab(page, name) {
  await tab(page, name).click();
  await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
}

/** The number painted on a KPI tile, read back as a number. */
async function kpiValue(page, label) {
  const text = await page.getByTitle(`View ${label} listings`).innerText();
  const digits = text.match(/[\d,]+/);
  expect(digits, `the ${label} tile painted no number at all`).not.toBeNull();
  return Number(digits[0].replace(/,/g, ''));
}

/**
 * `components/ui/Select` is a button plus a portalled listbox, so `selectOption` throws and a plain
 * click can land before the portal mounts - the `aria-expanded` assertions make it deterministic.
 */
async function pickOption(page, ariaLabel, optionText) {
  const trigger = page.getByRole('button', { name: ariaLabel });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.dz-dropdown__option', { hasText: optionText }).first().click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toContainText(optionText);
}

test.describe('LIVE: the properties console', () => {
  test('the console opens for an administrator and renders clean', async ({ page, login, consoleErrors }) => {
    await login.asAdmin();
    await openConsole(page);

    /* The subtitle distinguishes the full console from the cut-down one an account without
       `properties:write` gets, so asserting it is asserting which of the two screens loaded. */
    await expect(page.getByText('Manage, verify and curate every listing')).toBeVisible();
    /* And the strip below it, which only renders once `all` is non-null — so this is also the
       evidence that the fetch resolved into a rendered screen rather than into a spinner. */
    await expect(page.getByRole('tab')).toHaveCount(TABS.length);

    expect(realErrors(consoleErrors)).toEqual([]);
  });

  test('the strip is exactly the nine supply tabs, and All Listings is the default', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);

    /* Order matters as much as membership: the strip reads left to right as a workflow, so a tab
       that moves changes which one a moderator's muscle memory hits first. */
    const labels = await page.getByRole('tab').allInnerTexts();
    expect(labels).toHaveLength(TABS.length);
    TABS.forEach((pattern, i) => expect(labels[i].trim()).toMatch(pattern));

    /* Landing anywhere other than All Listings would mean the console had an opinion about what the
       operator came here to do. That opinion belongs to the KPI tiles. */
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(tab(page, 'All Listings')).toHaveAttribute('aria-selected', 'true');
  });

  test('switching tabs moves the selection and the URL follows it', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);

    await openTab(page, 'Verification Queue');

    /* Exactly one selected tab, not "the new one is selected": a strip that adds a selection instead
       of moving it looks right in a screenshot and is unreadable to a screen reader. */
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(tab(page, 'All Listings')).toHaveAttribute('aria-selected', 'false');

    /* The URL is what makes this console shareable: pasting the address bar into a thread has to
       send the queue the moderator was looking at, not the console's front page. */
    await expect(page).toHaveURL(/[?&]tab=verify\b/);
  });

  test('a deep link opens the tab it names', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page, '?tab=featured');

    /* The other direction of the same contract: a link a colleague was sent has to resolve to the
       tab, not to the default with a stale query string hanging off it. */
    await expect(tab(page, 'Featured')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  });

  test('all seven KPI tiles render and each jumps to its queue', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);

    for (const label of KPI_LABELS) {
      await expect(page.getByTitle(`View ${label} listings`)).toBeVisible();
    }

    /* Each tile has to land on the list that explains its number. `Pending` counts `status ===
       'pending'` but jumps to the Verification Queue, which ignores the archived flag. */
    const jumps = [
      ['Total', 'All Listings', /[?&]tab=all\b/],
      ['Active', 'All Listings', /[?&]tab=all\b/],
      ['Pending', 'Verification Queue', /[?&]tab=verify\b/],
      ['Flagged', 'Flagged', /[?&]tab=flagged\b/],
      ['Re-check', /^Re-check Queue/, /[?&]tab=recheck\b/],
      ['Featured', 'Featured', /[?&]tab=featured\b/],
      ['Duplicate', /^Duplicates/, /[?&]tab=duplicates\b/],
    ];

    for (const [label, tabName, url] of jumps) {
      await page.getByTitle(`View ${label} listings`).click();
      await expect(tab(page, tabName)).toHaveAttribute('aria-selected', 'true');
      await expect(page).toHaveURL(url);
    }

    /* The tile's number is not asserted: on a shared catalogue it is whatever other sessions left
       behind. `live-duplicates.spec.js` seeds a known collision and follows it through the merge. */
  });

  test('a bookmarked ?tab=duplicates opens the duplicates tab', async ({ page, login }) => {
    /* The deep link is how one moderator sends another a queue, and it is the half of `useTabParam`
       the "switching tabs writes the URL" test above does not cover. */
    await login.asAdmin();
    await page.goto('/admin/properties?tab=duplicates');

    await expect(tab(page, /^Duplicates/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  });

  test('the KPI tiles and the row counter agree with the listings the server returned', async ({ page, login }) => {
    /* A pending listing is created first so the Pending tile is provably counting something real
       rather than passing on a zero it agrees with by coincidence. */
    const subject = await pendingListing(`kpi ${Date.now().toString(36)}`);

    await login.asAdmin();
    const payload = await openConsole(page);

    const rows = payload.content;
    expect(Array.isArray(rows)).toBe(true);
    /* If the subject is not in the body the page rendered from, every comparison below would still
       pass while proving nothing about a listing this test can account for. */
    expect(rows.some((p) => p.id === subject.id)).toBe(true);

    /* The tiles are the database's counts over the whole catalogue, taken from the exact
       `/summary` body the strip rendered from - a page-derived expectation could not fail. */
    const s = payload.summary;
    const expected = {
      Total: s.total,
      Active: s.approved,
      Pending: s.pending,
      Flagged: s.flagged,
      'Re-check': s.recheck,
      Featured: s.featured,
    };
    expect(expected.Pending).toBeGreaterThan(0);

    for (const [label, value] of Object.entries(expected)) {
      expect(await kpiValue(page, label), `the ${label} tile disagrees with the catalogue it counts`).toBe(value);
    }

    /* Only when the catalogue outgrows the page can the two readings differ, and only then can this
       catch a Total tile that counts the fetched page instead of the catalogue. */
    const pageLocalTotal = rows.filter((p) => p.archived !== true).length;
    if (s.total > rows.length) {
      expect(await kpiValue(page, 'Total'),
        'the Total tile is counting the fetched page, not the catalogue').not.toBe(pageLocalTotal);
    }

    /* `Duplicate` is deliberately absent from that table: its count is proven where a known
       collision can be put into the catalogue and watched, in `live-duplicates.spec.js`. */

    /* The counter beside the search box makes the same claim one layer down: `N of M` where M is the
       server's count of everything that matched, not the length of the page the client fetched. */
    await expect(page.getByText(`of ${s.total.toLocaleString('en-IN')} listings`)).toBeVisible();

    /* A page smaller than the match is stated outright rather than inferred from a row count nobody
       compares: an operator who cannot tell a short list from a paged one works the wrong queue. */
    if (s.total > rows.length) {
      await expect(page.getByTestId('all-truncated')).toBeVisible();
    }
    if (rows.length > PAGE_LIMIT) {
      await expect(cards(page)).toHaveCount(PAGE_LIMIT);
    }

    /* Two claims the assertions above do not make: the exact row count when the match set is under the cap,
       and that a card renders the title and locality the server filed (matched by id — the sort is theirs). */
    const rendered = Math.min(s.total, rows.length, PAGE_LIMIT);
    await expect(cards(page), 'the grid dropped rows the server returned').toHaveCount(rendered);

    const subjectRow = rows.find((p) => p.id === subject.id);
    const subjectCard = cards(page).filter({ hasText: subject.title });
    if (await subjectCard.count()) {
      await expect(subjectCard.first().getByRole('heading').first()).not.toBeEmpty();
      if (subjectRow?.locality) {
        await expect(subjectCard.first(),
          'the card is not showing the locality the server filed the listing under',
        ).toContainText(subjectRow.locality);
      }
    }
  });

  test('search finds a listing by title, and an unmatchable term empties the list', async ({ page, login }) => {
    const subject = await pendingListing(`search ${Date.now().toString(36)}`);

    await login.asAdmin();

    /* The catalogue's true size, fetched independently: counting the rows the page itself fetched
       is the bug this test holds shut ("1 of 100" against 207 real listings). */
    const summary = await (await fetch(`${API}/admin/properties/summary`, {
      headers: await authHeaders(ACTORS.admin),
    })).json();

    await openConsole(page);

    /* The unfiltered denominator is the whole catalogue: on a database larger than the provider's page size
       only a server-side count can produce this number, so a client-side `all.length` fails here. */
    await expect(page.getByText(`of ${summary.total.toLocaleString('en-IN')} listings`)).toBeVisible();

    /* A tag no other row can contain makes this exact on a shared catalogue: the expected result is one, not
       "fewer than before". The row this test put in the database is the only thing it knows for certain. */
    const search = page.getByPlaceholder('Search title, owner, locality');
    await search.fill(subject.tag);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(subject.title);
    /* "1 of 1" — the server counted the match, so the denominator narrows with the query. Under the
       old client-side filter the numerator narrowed and the denominator stayed at the page cap. */
    await expect(page.getByText('1 of 1 listings')).toBeVisible();

    /* The empty state is a product decision, not a fallback: rendering the unfiltered list instead — what a
       filter that silently ignores an unmatched term does — is how a moderator acts on the wrong listing. */
    await search.fill(`zztest-nothing-can-match-${Date.now()}`);
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByText('No listings match your filters')).toBeVisible();
    await expect(page.getByText('0 of 0 listings')).toBeVisible();

    /* A many-row term, because a one-row match on a unique tag is indistinguishable from a lucky sort.
       `Baner` is the seeded locality with the most rows, so an empty result is a finding. */
    await search.fill('Baner');
    const localityCards = cards(page);
    await expect(localityCards, 'searching a seeded locality returned nothing').not.toHaveCount(0);
    for (const card of await localityCards.all()) {
      await expect(card, 'a row survived the search without matching the term').toContainText(/Baner/i);
    }
  });

  test('the status, deal and date filters each narrow the list', async ({ page, login }) => {
    const subject = await pendingListing(`filters ${Date.now().toString(36)}`);

    await login.asAdmin();
    await openConsole(page);

    /* Narrowed to one row this test set itself: "the count changed" is also satisfied by a filter that drops
       everything, and a one-row set cannot be confounded by the fifteen-row page limit. */
    await page.getByPlaceholder('Search title, owner, locality').fill(subject.tag);
    await expect(cards(page)).toHaveCount(1);

    // Status. A new submission is pending, and pending is not approved.
    await pickOption(page, 'Filter by status', 'Approved');
    await expect(cards(page)).toHaveCount(0);
    await pickOption(page, 'Filter by status', 'Pending');
    await expect(cards(page)).toHaveCount(1);
    await pickOption(page, 'Filter by status', 'All statuses');
    /* Resetting has to restore the row, not merely stop narrowing: a dropped `All statuses` leaves
       the previous filter latched while the select reads unfiltered. */
    await expect(cards(page), 'clearing the status filter did not restore the row').toHaveCount(1);

    // Deal. `DealPills` is a button group, not a select — it writes `fDeal` straight through.
    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    await expect(cards(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Rent', exact: true }).click();
    await expect(cards(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'All', exact: true }).first().click();

    /* `7d`, not `Today`: `propertyMapper` slices `createdAt` to `YYYY-MM-DD`, so between 00:00 and
       05:30 IST a just-created row compares as over a day old and `Today` would drop it. */
    await page.getByRole('button', { name: '7d', exact: true }).click();
    await expect(cards(page)).toHaveCount(1);
  });

  test('the verification queue offers a case file with everything an approval decision needs', async ({ page, login }) => {
    const subject = await pendingListing(`review ${Date.now().toString(36)}`);

    await login.asAdmin();

    /* Both directions: the `N pending` count belongs to the verification queue, so a counter that
       renders on every tab tells a moderator there is work waiting at whichever desk they stand. */
    await openConsole(page);
    await expect(page.getByText(/\d+ pending/),
      'the verification backlog is being counted on a tab it does not belong to',
    ).toHaveCount(0);

    await openConsole(page, '?tab=verify');
    await expect(tab(page, 'Verification Queue')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/\d+ pending/)).toBeVisible();

    /* Narrowed to this test's own listing: on a shared queue "the first card" is another session's work item,
       and opening a case file against it writes a reviewer claim onto a listing this test does not own. */
    await page.getByPlaceholder('Search title, owner, locality').fill(subject.tag);
    await expect(cards(page)).toHaveCount(1);

    /* The case file is a real server object, so this click is a write: waiting on the response separates
       "the modal rendered" from "the modal rendered something the server knows about". */
    await cards(page).getByRole('button', { name: 'Review', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Verify property' });
    await expect(dialog).toBeVisible();

    /* Scoped by accessible name throughout: `getByRole('dialog')` alone is never unique on this app — the
       cookie banner is one — so an unscoped query only lands right on a clean profile. */

    // Which listing. The modal prints `slug || id`, which for an unfiled new submission is the uuid.
    await expect(dialog).toContainText(subject.title);
    await expect(dialog).toContainText('Listing ID');
    await expect(dialog).toContainText(subject.label);

    /* What the decision is made from: the checked ratio is evidence the case file fetch resolved, the details
       grid is what the photos are checked against, and the thread is how a moderator asks before rejecting. */
    await expect(dialog).toContainText('Verification checklist');
    await expect(dialog).toContainText(/\d+ \/ \d+ checked/);
    await expect(dialog).toContainText('Property details');
    await expect(dialog).toContainText('Communicate with the owner');

    /* Typed a character at a time on purpose: `fill()` sets the value in one shot and passes against a dialog
       that steals focus back after every render — the state that lets an operator enter one character. */
    const composer = dialog.getByPlaceholder(/ask for a clarification/i);
    await composer.click();
    await page.keyboard.type('needs a clearer photo');
    await expect(composer,
      'the owner composer dropped keystrokes — the dialog is reclaiming focus on re-render',
    ).toHaveValue('needs a clearer photo');

    /* Both decisions side by side: this owns that the operator is offered both rather than funnelled towards
       approval, while `properties-moderation` owns what each verb does to the listing. */
    await expect(dialog.getByRole('button', { name: 'Approve & publish' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Reject' })).toBeVisible();

    /* Closing has to actually remove it: a modal left in the DOM behind an opacity change keeps focus and
       keeps its buttons clickable, so the next thing typed goes into a listing thought to be put down. */
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  /**
   * Each test below acts through the UI, then re-reads `GET /admin/properties` over a separate
   * connection, so a server that answered the request without honouring it fails on the row.
   */
  test('flagging a listing is a decision the server keeps, and clearing it returns it to review', async ({ page, login }) => {
    const subject = await pendingListing(`flag ${Date.now().toString(36)}`);
    const headers = await authHeaders(ACTORS.admin);

    /* Approved first, so the flag is a real transition out of the live catalogue: it also makes the drop back
       to `pending` legible as a decision, since clearing a flag returns a listing to the queue, not the site. */
    expect((await api('PATCH', `/properties/${subject.id}/status`, headers, { status: 'approved' })).status).toBe(200);

    /** The row as the server currently has it. Fails loudly rather than returning undefined. */
    const serverRow = async () => {
      const res = await api('GET', '/admin/properties?size=100', headers);
      expect(res.status).toBe(200);
      const row = res.body.content.find((p) => p.id === subject.id);
      expect(row, 'the listing this test created is not in the moderation queue').toBeTruthy();
      return row;
    };

    /* The premise, asserted rather than assumed: the approve above landed. Without this the flag
       assertion below could pass over a listing that was never approved in the first place. */
    expect((await serverRow()).status).toBe('approved');

    await login.asAdmin();
    await openConsole(page);
    await page.getByPlaceholder('Search title, owner, locality').fill(subject.tag);
    await expect(cards(page)).toHaveCount(1);

    const reason = 'Zztest moderation \u2014 raised by the live console spec';
    await cards(page).first().getByTitle('Flag').click();
    const flagModal = page.getByRole('dialog', { name: 'Flag listing' });
    await expect(flagModal).toBeVisible();

    /* An empty reason is refused. A flag with no reason is unreviewable by whoever picks the queue
       up next, and the guard is what makes `flag_reason` worth reading. */
    await flagModal.getByRole('button', { name: 'Flag listing', exact: true }).click();
    await expect(page.getByText('Add a reason before flagging')).toBeVisible();
    await expect(flagModal, 'a refused submit must not also dismiss the form').toBeVisible();

    /* The reason box is what the queue is worked from; the note is where a moderator puts what they will not
       publish to the owner. A form offering only the first sends internal wording to the owner, or loses it. */
    await expect(flagModal.getByText(/Internal note \(optional\)/i),
      'the flag form no longer offers anywhere to put what the owner should not read',
    ).toBeVisible();

    await flagModal.locator('textarea').first().fill(reason);

    /* Read back at the end of this test: a note filed from the flag form has to be legible from a *different*
       modal on the same listing, since the next moderator is as likely to reach for Archive as for Flag. */
    const noteText = 'Owner admitted the photos are the builder\u2019s renders.';
    await flagModal.getByRole('button', { name: /Internal note \(optional\)/ }).click();
    await flagModal.getByPlaceholder(/Add a note for the team/).fill(noteText);

    await flagModal.getByRole('button', { name: 'Flag listing', exact: true }).click();
    await expect(page.getByText('Listing flagged')).toBeVisible();

    /* The claim the mock cannot make. The toast says the browser thinks it worked; this says the
       database agrees, and carries the reason the moderator typed rather than a placeholder. */
    const flaggedRow = await serverRow();
    expect(flaggedRow.status, 'the flag never reached the server').toBe('flagged');
    expect(flaggedRow.flagReason ?? flaggedRow.flag_reason).toContain('Zztest moderation');

    /* And the queue the operator would work next actually holds it, with the action that undoes it.
       A flag the server keeps but the Flagged tab never shows is a listing nobody can un-flag. */
    await openTab(page, 'Flagged');
    await page.getByPlaceholder('Search title, owner, locality').fill(subject.tag);
    const flaggedCard = cards(page).filter({ hasText: subject.title });
    await expect(flaggedCard).toHaveCount(1);

    /* `doClearFlag` guards on `window.confirm` and Playwright auto-dismisses dialogs, so without this handler
       the click is a silent no-op and every assertion after it reports the *old* state as a failed write. */
    page.once('dialog', (d) => d.accept());
    await flaggedCard.getByTitle('Clear flag & return to review').click();
    await expect(page.getByText('Flag cleared \u2014 back in the review queue')).toBeVisible();

    /* Back in the queue, not back on the site: a withdrawn complaint does not mean anyone has since looked.
       `clearFlag` is a DELETE answering 204 with no body, so every browser-side signal is a client guess. */
    expect((await serverRow()).status, 'clearing the flag never reached the server').toBe('pending');

    /* The reload forces a fresh fetch. Asserted on *Archive* on purpose: a history scoped to the form that
       wrote it, or to the decision it accompanied, would leave the next moderator's screen blank. */
    await page.reload();
    await openTab(page, 'All Listings');
    await page.getByPlaceholder('Search title, owner, locality').fill(subject.tag);
    const archived = cards(page).filter({ hasText: subject.title });
    await expect(archived).toHaveCount(1);
    await archived.getByTitle('Archive').click();

    const archiveModal = page.getByRole('dialog', { name: 'Archive listing' });
    await expect(archiveModal).toBeVisible();
    await archiveModal.getByRole('button', { name: /1 previous note/ }).click();
    await expect(archiveModal.getByText(noteText),
      'a note filed from the flag form is not on the listing when it is opened from anywhere else',
    ).toBeVisible();
    await expect(archiveModal.getByText('Flagged', { exact: true }),
      'the note is on the listing but no longer says what was being done when it was written',
    ).toBeVisible();

    /* A history that drops the author renders a wall of anonymous lines. Matched on role names, not
       a person: the login fixture decides who decided, and pinning it would test the fixture. */
    await expect(archiveModal.getByText(/Admin|Staff/).first(),
      'the note history shows the words but not who wrote them',
    ).toBeVisible();
  });

  test('Export CSV downloads a file named for the active tab', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);

    /* The filename is the whole feature: these land in a spreadsheet beside four others pulled the same
       afternoon, and a misnamed one is a report about the wrong population nobody can tell apart later. */
    const expected = [
      ['All Listings', 'draazy-listings.csv'],
      ['Verification Queue', 'draazy-verification-queue.csv'],
      ['Flagged', 'draazy-flagged.csv'],
      ['Featured', 'draazy-featured.csv'],
    ];

    for (const [name, filename] of expected) {
      if (name !== 'All Listings') await openTab(page, name);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export CSV' }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(filename);
    }
  });

  test('the follow-up tab offers the reasons a listing can be stuck for', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);
    await openTab(page, 'Needs Follow-up');

    /* The sub-filter is the only place the three ways a listing stalls are named apart, and each needs a
       different action. The list itself is not asserted: what is stale today is a fact about the database. */
    await expect(page.getByText(/^\d+ listings$/)).toBeVisible();

    const trigger = page.getByRole('button', { name: 'Filter by reason' });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    for (const reason of ['All reasons', 'Stale pending', 'Awaiting owner', 'Unconfirmed (stale)']) {
      await expect(page.locator('.dz-dropdown__option', { hasText: reason })).toHaveCount(1);
    }

    /* Chosen from the already-open menu rather than through `pickOption`: that helper starts by
       clicking the trigger, which on an open `components/ui/Select` closes it. */
    await page.locator('.dz-dropdown__option', { hasText: 'Unconfirmed (stale)' }).first().click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toContainText('Unconfirmed (stale)');
    // Whichever way it lands, the tab has to say something: a blank pane reads as a broken fetch.
    await expect(
      page.locator('.dz-card').filter({ hasText: /haven't confirmed availability|All caught up/ }).first(),
    ).toBeVisible();
  });

  /**
   * The discriminator is a just-created listing, unambiguously not stale, held against a queue
   * proven non-empty: a too-wide predicate lists every live listing and still looks like work.
   */
  test('the follow-up queue is the owners who went quiet, not every listing that is live', async ({ page, login }) => {
    const headers = await authHeaders(ACTORS.admin);
    const fresh = await pendingListing('freshness');
    expect((await api('PATCH', `/properties/${fresh.id}/status`, headers, { status: 'approved' })).status)
      .toBe(200);

    const total = async (qs) => {
      const res = await api('GET', `/admin/properties?${qs}&size=1`, headers);
      expect(res.status, `GET /admin/properties?${qs}`).toBe(200);
      return res.body.totalElements;
    };

    const live = await total('status=approved&archived=false');
    const quiet = await total('status=approved&archived=false&unconfirmed=true');

    /* Spring drops an unknown query parameter without a 400, so a facet renamed or never wired would return
       the full catalogue and still pass "the queue has rows". `quiet < live` is the only shape that rules it out. */
    expect(quiet, 'the unconfirmed facet returned the whole live catalogue — it is not narrowing anything')
      .toBeLessThan(live);
    /* The other half of the vacuity guard: on an entirely fresh seed `quiet` would be zero, the inequality
       above would hold trivially, and the screen assertions would pass against a queue empty for its own reasons. */
    expect(quiet, 'the seed must carry at least one listing whose owner has gone quiet')
      .toBeGreaterThan(0);

    const inQueue = async (qs) => {
      const res = await api('GET', `/admin/properties?${qs}&q=${encodeURIComponent(fresh.title)}&size=50`, headers);
      expect(res.status).toBe(200);
      return res.body.content.some((l) => l.id === fresh.id);
    };
    expect(await inQueue('status=approved&archived=false'), 'the listing this test just approved is not live')
      .toBe(true);
    expect(await inQueue('status=approved&archived=false&unconfirmed=true'),
      'a listing created moments ago is being chased as though its owner had gone quiet')
      .toBe(false);

    /* The same term in two boxes on one console must give opposite answers. On screen rather than by a third
       fetch, because it is `unconfirmedQueue`'s parameters — not the endpoint's — that decide who gets rung. */
    await login.asAdmin();
    await openConsole(page);
    /* Both tabs use this same placeholder, and only the active one is mounted — so the locator is
       unambiguous at each point and reads as the same box being retyped, which is the claim. */
    const searchBox = page.getByPlaceholder('Search title, owner, locality\u2026');
    await searchBox.fill(fresh.title);
    await expect(cards(page).filter({ hasText: fresh.title })).toHaveCount(1);

    await openTab(page, 'Needs Follow-up');
    await pickOption(page, 'Filter by reason', 'Unconfirmed (stale)');
    await searchBox.fill(fresh.title);
    await expect(page.getByText(/All caught up/)).toBeVisible();
    await expect(cards(page).filter({ hasText: fresh.title })).toHaveCount(0);
  });

  /* The server derives `postedByStaff` from the caller's token, so it is a uuid the browser has no
     say over — the tab's filter is therefore the only thing under test here. */

  /** A listing the desk typed on somebody's behalf, under an owner nobody else shares. */
  async function conciergeListing(tag) {
    const title = `Zztest console ${tag}`;
    const res = await api('POST', '/admin/properties', await authHeaders(ACTORS.admin), {
      ownerMobile: uniqueMobile(),
      ownerName: 'Zztest Concierge Owner',
      listing: { ...BASE_LISTING, title },
    });
    expect(res.status).toBe(201);
    created.add(res.body.id);
    return { id: res.body.id, title, tag };
  }

  test('the Staff Posted tab holds what the desk typed, and not what an owner sent in', async ({ page, login }) => {
    const tag = Date.now().toString(36);
    const desk = await conciergeListing(`staff ${tag}`);
    /* The row that makes the exclusion mean something: identical on every axis this tab does not filter on,
       so the only reason it can be missing below is the one under test. */
    const owner = await pendingListing(`self ${tag}`);

    await login.asAdmin();
    await openConsole(page, '?tab=staff');
    await expect(tab(page, 'Staff Posted')).toHaveAttribute('aria-selected', 'true');

    /* Present first: this tab starts empty on every page load, so an absence asserted before anything has
       rendered is a statement about an empty pane. Searched by title tag — the server holds a uuid, not a name. */
    const search = page.getByPlaceholder('Search title, owner, locality');
    await search.fill(desk.tag);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(desk.title);

    // Then absent, on the same tab, through the same box.
    await search.fill(owner.tag);
    await expect(cards(page)).toHaveCount(0);

    /* What turns that zero into evidence: the owner's listing *is* in the catalogue and findable by this exact
       string. Without it a bad tag, a failed creation or a console rendering no cards all read as a filter. */
    await openTab(page, 'All Listings');
    await page.getByPlaceholder('Search title, owner, locality').fill(owner.tag);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(owner.title);
  });

  test('a concierge listing is drawn with the hand-back pipeline an owner submission never gets', async ({ page, login }) => {
    /* `AdminPropertyCard` picks between two progress rows on `postedByAdmin`, which defaults to `false` if the
       mapper loses it — a silent "In Review" on a concierge row. Nothing errors, so assert both sides. */
    const tag = Date.now().toString(36);
    const desk = await conciergeListing(`pipe ${tag}`);
    const owner = await pendingListing(`pipe-self ${tag}`);

    await login.asAdmin();
    await openConsole(page, '?tab=all');

    const search = page.getByPlaceholder('Search title, owner, locality');

    await search.fill(desk.tag);
    await expect(cards(page)).toHaveCount(1);
    /* `STAFF_STEPS`. "Photos & Docs" belongs to no other progress row on this screen. */
    await expect(cards(page).first()).toContainText('Photos & Docs');
    await expect(cards(page).first()).not.toContainText('In Review');

    await search.fill(owner.tag);
    await expect(cards(page)).toHaveCount(1);
    /* `OWNER_STEPS`, and the mirror image. Asserted rather than assumed because "the desk card said
       Photos & Docs" is only interesting if the other kind of card does not. */
    await expect(cards(page).first()).toContainText('In Review');
    await expect(cards(page).first()).not.toContainText('Photos & Docs');
  });

  test('moving a card across the pipeline board is a stage the server stores', async ({ page, login }) => {
    /* `POST /properties/{id}/pipeline` 400s on anything outside its eight values, and two of this board's six
       columns are `status` read sideways, so this asserts the four the dropdown offers are accepted. */
    const desk = await conciergeListing(`stage ${Date.now().toString(36)}`);
    const headers = await authHeaders(ACTORS.admin);

    /* `adminPipeline.pipelineStage`, not a top-level field: this read sits below `propertyMapper`,
       so it must speak the wire's vocabulary or it reads `undefined` forever. */
    const serverStage = async () => {
      const res = await api('GET', '/admin/properties?size=100', headers);
      expect(res.status).toBe(200);
      const row = res.body.content.find((p) => p.id === desk.id);
      expect(row, 'the concierge listing this test created is not in the moderation queue').toBeTruthy();
      return row.adminPipeline?.pipelineStage ?? null;
    };

    const before = await serverStage();

    await login.asAdmin();
    await openConsole(page, '?tab=pipeline');
    await expect(tab(page, 'Pipeline')).toHaveAttribute('aria-selected', 'true');

    /* `Contacted` because it is an acquisition stage (so it lands in `pipeline_stage`, the field
       read back below) and because a concierge listing is created at `listed`, not there. */
    const card = page.locator('.rounded-xl', { hasText: desk.title }).last();
    await expect(card).toBeVisible();
    const stagePicker = card.locator('[aria-label^="Change pipeline stage"]').first();
    await expect(stagePicker).toBeVisible();
    await stagePicker.click();

    const menu = page.getByRole('listbox');
    await expect(menu).toBeVisible();
    /* The derived pair are absent from the menu, asserted here rather than in a test of its own:
       offering them would put a 400 behind a control that looks like the other four. */
    for (const derived of ['Under Review', 'Live']) {
      await expect(menu.getByText(derived, { exact: true })).toHaveCount(0);
    }
    await menu.getByText('Contacted', { exact: true }).click();

    /* The claim. `setPipelineStage` drops the response body by design, so a 400 here would leave
       the board showing whatever it optimistically drew and nothing else would say otherwise. */
    await expect
      .poll(serverStage, { message: 'the stage change never reached the server' })
      .toBe('contacted');
    /* The other half of that claim, and the reason it is asserted rather than assumed: a move to a
       stage the row was already in is satisfied by a server that ignored the request entirely. */
    expect(before, 'the fixture already sat in the stage under test, so the write proves nothing').not.toBe('contacted');
  });

  /*
   * Each tab issues its own facetted `GET /admin/properties`, so these tests assert the facet
   * reached the server and that the screen's count is the server's `totalElements`, not a page's.
   */
  const QUEUES = [
    { name: 'Verification Queue', facet: 'status=pending', param: 'status=pending', banner: 'verify-truncated', search: 'Search title, owner, locality' },
    { name: 'Flagged', facet: 'status=flagged', param: 'status=flagged', banner: 'flagged-truncated', search: 'Search title, owner, locality' },
    { name: 'Featured', facet: 'featured=true', param: 'featured=true', banner: 'featured-truncated', search: 'Search title, owner, locality' },
    { name: 'Staff Posted', facet: 'postedByAdmin=true', param: 'postedByAdmin=true', banner: 'staff-truncated', search: 'Search title, owner, locality' },
  ];

  /** `PAGE_SIZE` in `services/providers/http/propertyProvider.js` — the cap that caused all of this. */
  const PAGE_SIZE = 100;

  /* The banner prints through `fmtNum` (`en-IN` grouping), so asserting raw digits would pass today
     and start failing the day the catalogue crossed a lakh. */
  const fmtNum = (n) => Number(n).toLocaleString('en-IN');

  /**
   * Each row goes through the route an operator would use, not a direct status write, so the
   * fixture stops passing if the verb that produces the state stops producing it.
   */
  async function seedInto(queueName, tag) {
    const admin = await authHeaders(ACTORS.admin);
    /* Staff Posted reads `posted_by_admin`, a column only the concierge route sets, so this one
       cannot start from an owner-created listing at all. */
    if (queueName === 'Staff Posted') return conciergeListing(`${tag} staff`);

    const listing = await pendingListing(tag);
    if (queueName === 'Verification Queue') return listing;
    if (queueName === 'Flagged') {
      const res = await api('POST', `/properties/${listing.id}/flag`, admin, {
        reason: 'Zztest \u2014 synthetic flagged fixture',
      });
      expect(res.status, 'the flag verb did not accept the fixture').toBeLessThan(300);
      return listing;
    }
    /* Featuring is a toggle on an approved listing, which is also the honest shape: nothing is promoted to the
       front page out of the pending queue. The verb is `toggle-featured`; `featured` 404s. */
    const ok = await api('PATCH', `/properties/${listing.id}/status`, admin, { status: 'approved' });
    expect(ok.status, 'the fixture could not be approved').toBeLessThan(300);
    const res = await api('POST', `/properties/${listing.id}/toggle-featured`, admin);
    expect(res.status, 'the featured toggle did not accept the fixture').toBeLessThan(300);
    return listing;
  }

  for (const q of QUEUES) {
    test(`the ${q.name} queue is sized by the server, not by the first page`, async ({ page, login }) => {
      const fixture = await seedInto(q.name, `q${Date.now().toString(36)}`);
      const admin = await authHeaders(ACTORS.admin);

      /* An independent read of the same facet, `size=1` because `totalElements` is the whole answer: fetching
         rows would invite comparing arrays, and three other specs write to this catalogue. */
      const truth = await api('GET', `/admin/properties?${q.facet}&archived=false&page=0&size=1`, admin);
      expect(truth.status).toBe(200);
      const serverTotal = truth.body.totalElements;
      expect(serverTotal, `no listing is in the ${q.name} queue, so nothing below can fail`)
        .toBeGreaterThan(0);

      /* (1) The facet reaches the server. Armed before `openConsole`, not the tab click: every queue hook runs
         on mount. `size` is in the predicate because the topbar bell also reads `status=pending`. */
      const queueReq = page.waitForRequest(
        (r) => r.method() === 'GET'
          && r.url().includes('/api/admin/properties?')
          && r.url().includes(q.param)
          && new URL(r.url()).searchParams.get('size') === String(PAGE_SIZE),
      );
      await login.asAdmin();
      await openConsole(page);
      const req = await queueReq;
      expect(new URL(req.url()).searchParams.get('archived'), 'the queue asked for archived rows too')
        .toBe('false');

      await openTab(page, q.name);

      /* (2) The count on screen is the server's count. Which number carries it depends on size: above
         `PAGE_LIMIT` the hint states the total, above `PAGE_SIZE` only the banner does. */
      const reachable = Math.min(serverTotal, PAGE_SIZE);
      if (serverTotal > PAGE_SIZE) {
        await expect(page.getByTestId(q.banner)).toContainText(fmtNum(serverTotal));
      }
      if (reachable > PAGE_LIMIT) {
        await expect(page.getByText(`Showing ${PAGE_LIMIT} of ${reachable}`)).toBeVisible();
      } else {
        await expect(cards(page)).toHaveCount(reachable);
      }

      /* The positive anchor, last: a count alone is satisfied by a coincidence, so assert the queue
         holds the row that was put into it. */
      await page.getByPlaceholder(q.search).fill(fixture.title);
      await expect(page.getByText(fixture.title, { exact: false }).first()).toBeVisible();
    });
  }

  /**
   * The subject is the oldest row in the queue and is asserted absent from the fetched page, so a
   * browser-side filter over the loaded array could not satisfy either search term below.
   */
  test('an owner name or id fragment finds a queue row the fetched page never held', async ({ page, login }) => {
    const admin = await authHeaders(ACTORS.admin);
    const facet = 'status=pending&archived=false';

    const head = await api('GET', `/admin/properties?${facet}&page=0&size=${PAGE_SIZE}&sort=newest`, admin);
    expect(head.status).toBe(200);
    const total = head.body.totalElements;
    test.skip(total <= PAGE_SIZE,
      `the verification queue holds ${total} rows, so nothing is out of the console's reach and there is no row this test could prove anything with`);

    /* The last row of a newest-first sort: the furthest thing from the fetched page there is. */
    const tail = await api('GET', `/admin/properties?${facet}&page=${total - 1}&size=1&sort=newest`, admin);
    expect(tail.status).toBe(200);
    const deep = tail.body.content[0];
    expect(deep, 'the queue reported a size it could not then page to').toBeTruthy();

    const fetched = head.body.content.map((p) => p.id);
    expect(fetched, 'the oldest row is inside the fetched page, so a browser-side filter would have found it too and none of the assertions below can fail')
      .not.toContain(deep.id);

    const ownerName = deep.owner?.name;
    expect(ownerName, 'the queue row has no owner name, so the axis under test does not exist on it').toBeTruthy();

    await login.asAdmin();
    await openConsole(page);
    await openTab(page, 'Verification Queue');
    const box = page.getByPlaceholder('Search title, owner, locality');

    /* Each term is checked for selectivity against the server before it is typed, so a term matching more rows
       than one page renders can never fail this as though the search were broken. */
    for (const [axis, term] of [
      ['owner name', ownerName],
      ['id fragment', deep.id.slice(-8)],
    ]) {
      const matches = await api('GET', `/admin/properties?${facet}&page=0&size=1&q=${encodeURIComponent(term)}`, admin);
      expect(matches.status, `searching by ${axis} was refused`).toBe(200);
      expect(matches.body.totalElements, `the server matches nothing by ${axis}`).toBeGreaterThan(0);
      test.skip(matches.body.totalElements > PAGE_LIMIT,
        `"${term}" matches ${matches.body.totalElements} rows, more than the list renders at once`);

      await box.fill(term);
      /* The row itself, by title, on a screen that could not have been holding it. `.first()`
         because a queue may legitimately hold two listings from the same owner. */
      await expect(
        page.getByText(deep.title, { exact: false }).first(),
        `searching by ${axis} did not reach a row past the fetched page`,
      ).toBeVisible();
    }
  });

  /**
   * The mobile is asserted absent from the row's title, owner name, locality and id, so a match
   * cannot be an incidental hit on the fields a browser-side filter already concatenated.
   */
  test("an owner's phone number finds their listing, which no browser-side filter could have matched", async ({ page, login }) => {
    const admin = await authHeaders(ACTORS.admin);
    const facet = 'status=pending&archived=false';

    const head = await api('GET', `/admin/properties?${facet}&page=0&size=${PAGE_SIZE}&sort=newest`, admin);
    expect(head.status).toBe(200);

    const row = head.body.content.find((p) => p.owner?.mobile && p.owner?.name);
    expect(row, 'no row in the verification queue carries an owner mobile, so the axis under test does not exist on this data').toBeTruthy();
    const term = row.owner.mobile;

    /* Exactly the predicate the old build applied in the browser, rebuilt over this row. If the
       number turns up inside it, the old filter would have matched too and this proves nothing. */
    const oldFilterHaystack = `${row.title}${row.owner.name}${row.locality || ''}${row.id}`.toLowerCase();
    expect(
      oldFilterHaystack,
      'the mobile occurs inside the fields the browser-side filter already searched, so matching it does not prove the search reaches the owner record',
    ).not.toContain(term.toLowerCase());

    /* And selective, checked against the server before it is typed, so a shared office number
       cannot fail this as though the search were broken. */
    const matches = await api('GET', `/admin/properties?${facet}&page=0&size=1&q=${encodeURIComponent(term)}`, admin);
    expect(matches.status, 'searching by owner mobile was refused').toBe(200);
    expect(matches.body.totalElements, 'the server matches nothing by owner mobile').toBeGreaterThan(0);
    test.skip(matches.body.totalElements > PAGE_LIMIT,
      `"${term}" matches ${matches.body.totalElements} rows, more than the list renders at once`);

    await login.asAdmin();
    await openConsole(page);
    await openTab(page, 'Verification Queue');
    await page.getByPlaceholder('Search title, owner, locality').fill(term);

    await expect(
      page.getByText(row.title, { exact: false }).first(),
      'searching by the owner\u2019s phone number did not reach their listing',
    ).toBeVisible();
  });

  /**
   * Each absence from the public search is paired with the same term found by the admin search, so
   * the pair proves the term is a real key that works from a desk and not from the street.
   */
  test('the public search cannot be turned into an owner directory', async ({ page }) => {
    const admin = await authHeaders(ACTORS.admin);

    const publicList = await api('GET', '/properties?page=0&size=1&sort=newest');
    expect(publicList.status).toBe(200);
    const listed = publicList.body.content[0];
    expect(listed, 'the public catalogue is empty, so there is no published row to test with').toBeTruthy();

    /* The owner's real details, read from the side that is allowed to have them. */
    const full = await api('GET', `/admin/properties?page=0&size=1&q=${encodeURIComponent(listed.id)}`, admin);
    expect(full.status).toBe(200);
    const owner = full.body.content[0]?.owner;
    expect(owner?.name, 'could not read the owner of the published row').toBeTruthy();
    expect(owner?.mobile, 'could not read the owner mobile of the published row').toBeTruthy();

    const publicTotal = async (term) => {
      const res = await api('GET', `/properties?page=0&size=5&q=${encodeURIComponent(term)}`);
      expect(res.status, `the public search refused "${term}"`).toBe(200);
      return res.body.totalElements;
    };
    const adminTotal = async (term) => {
      const res = await api('GET', `/admin/properties?page=0&size=5&q=${encodeURIComponent(term)}`, admin);
      expect(res.status, `the moderation search refused "${term}"`).toBe(200);
      return res.body.totalElements;
    };

    /* The anchor: this row is reachable through the public search by the words on its own card, so everything
       below is about the *term*, not about the row being invisible or the endpoint being broken. */
    const titleWord = listed.title.split(' ').find((w) => w.length > 3) || listed.title;
    expect(await publicTotal(titleWord), 'the public search cannot even find a published row by its title')
      .toBeGreaterThan(0);

    expect(await adminTotal(owner.mobile), 'the desk cannot find the row by the number the caller reads out')
      .toBeGreaterThan(0);
    expect(await publicTotal(owner.mobile), 'a visitor searched an owner phone number and the catalogue answered')
      .toBe(0);

    /* Names are weaker evidence than numbers, because an owner's name can legitimately occur in a
       title or a locality. Only asserted when it does not. */
    if (!`${listed.title} ${listed.locality || ''}`.toLowerCase().includes(owner.name.toLowerCase())) {
      expect(await adminTotal(owner.name), 'the desk cannot find the row by its owner name').toBeGreaterThan(0);
      expect(await publicTotal(owner.name), 'a visitor searched an owner name and the catalogue answered').toBe(0);
    }
  });

  /**
   * Typing and clicking with no settle in between is the subject: a queue whose rows answer the
   * previous term must be inert, or a click lands on a different owner's listing.
   */
  test('a row clicked the instant a term is typed is the row that was typed for', async ({ page, login }) => {
    const admin = await authHeaders(ACTORS.admin);
    const facet = 'status=pending&archived=false';

    const head = await api('GET', `/admin/properties?${facet}&page=0&size=${PAGE_SIZE}&sort=newest`, admin);
    expect(head.status).toBe(200);
    const total = head.body.totalElements;
    test.skip(total < 2, `the queue holds ${total} rows, so there is no second row for a mis-aimed click to land on`);

    const top = head.body.content[0];
    /* The oldest row: as far from the top of a newest-first list as the queue goes. */
    const tail = await api('GET', `/admin/properties?${facet}&page=${total - 1}&size=1&sort=newest`, admin);
    expect(tail.status).toBe(200);
    const target = tail.body.content[0];
    expect(target, 'the queue reported a size it could not then page to').toBeTruthy();
    expect(target.id, 'the oldest row is also the newest, so there is only one row here').not.toBe(top.id);

    /* An id rather than a title or a name: it matches exactly one row by construction, so after
       the fetch settles the target is the only thing the list can be showing. */
    const selective = await api('GET', `/admin/properties?${facet}&page=0&size=1&q=${encodeURIComponent(target.id)}`, admin);
    expect(selective.status).toBe(200);
    expect(selective.body.totalElements, 'searching a listing id matched something other than that listing').toBe(1);

    await login.asAdmin();
    await openConsole(page);
    await openTab(page, 'Verification Queue');

    /* The guard. Without a different listing sitting on top first, a click that ignored the search
       term entirely would still open the right row and this test would pass on a broken build. */
    const firstCard = cards(page).first();
    await expect(firstCard, 'the queue rendered no rows to aim at').toBeVisible();
    await expect(firstCard, 'the newest row is already the target, so a mis-aimed click has nothing wrong to hit')
      .toContainText(top.title);

    await page.getByPlaceholder('Search title, owner, locality').fill(target.id);

    /* Asserted before the click, so the click below is provably made into a queue that is mid-update rather
       than one that already settled — otherwise this passes just by being slow. */
    await expect(
      page.getByTestId('queue-updating'),
      'the queue never marked itself as answering a stale term, so the click below is not being made during the window this test is about',
    ).toBeVisible();

    /* Deliberately no wait: this is the click a real operator makes, into rows that still answer the previous
       term. Exact, because `getByTitle('View')` also matches the shell's "View live site" button. */
    await cards(page).first().getByTitle('View', { exact: true }).click();

    /* Then let it settle. This is also the anchor that stops the absence check below being vacuous: a broken
       search fails here first, rather than "no wrong modal" passing on an empty screen. */
    await expect(
      cards(page).first(),
      'the search never resolved to the row it selects, so nothing below is being proven',
    ).toContainText(target.title);

    /* Discarded or honoured late are both safe and neither is the contract. The contract is that it never
       acted on the row underneath it, so a modal open at this point must be the target's. */
    const details = page.getByRole('dialog');
    if (await details.count()) {
      await expect(details, 'the console acted on the row that was on screen before the search, not the one that was searched for')
        .toContainText(target.title);
    } else {
      /* Discarded. The positive half: the button is not simply broken, and a click made once the
         rows answer the term opens the row the desk was looking for. */
      await cards(page).first().getByTitle('View', { exact: true }).click();
      await expect(details, 'View did nothing even on a settled queue').toBeVisible();
      await expect(details).toContainText(target.title);
    }
    await expect(details, 'the details on screen belong to the row that was on top before the search')
      .not.toContainText(top.title);
  });

  test('a signed-in buyer cannot reach the console', async ({ page, login }) => {
    /* `RoleRoute` is role-based, not atom-based: a consumer session is bounced out of the shell rather than
       shown a console whose every fetch 403s. The API half belongs to the moderation spec. */
    await login.asBuyer();
    await page.goto('/admin/properties');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin/properties'));
    expect(new URL(page.url()).pathname).not.toBe('/admin/properties');
  });

  test('a signed-out visitor is sent to the staff sign-in', async ({ page }) => {
    /* `/staff-login`, not `/signin`: a moderator signing in as themselves gets a consumer session and fails
       the same role check — a loop that reads as a broken account rather than a wrong door. */
    await page.goto('/admin/properties');
    await page.waitForURL(/\/staff-login/);
    expect(new URL(page.url()).pathname).toBe('/staff-login');
  });

  /* `Active` and `Total` both select All Listings, and the all-tile sweep reaches Active after Total, so it
     cannot tell a working click from a button wired to nothing. Start on Pipeline to make it observable. */
  test('the Active KPI leaves a non-All queue and returns the desk to All Listings', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);
    await openTab(page, 'Pipeline');
    await page.getByTitle('View Active listings').click();
    await expect(tab(page, 'All Listings')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\?tab=all$/);
  });

  /* The pipeline is a six-column view over a live catalogue. Its final two stages are derived
     from status and consequently must never appear in a stage-changing menu. */
  test('the live pipeline keeps every supported column visible and only offers stored stages', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);
    await openTab(page, 'Pipeline');

    for (const stage of ['Contacted', 'Info Collected', 'Listed', 'Docs Submitted', 'Under Review', 'Live']) {
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(/^\d+ total$/)).toBeVisible();

    const selector = page.locator('[aria-label^="Change pipeline stage"]').first();
    await expect(selector).toBeVisible();
    await selector.click();
    const menu = page.getByRole('listbox');
    await expect(menu).toBeVisible();
    for (const stored of ['Contacted', 'Info Collected', 'Listed', 'Docs Submitted']) {
      await expect(menu.getByText(stored, { exact: true })).toBeVisible();
    }
    for (const derived of ['Under Review', 'Live']) {
      await expect(menu.getByText(derived, { exact: true })).toHaveCount(0);
    }
  });

  /* The header total includes all unarchived rows. The displayed columns may omit rejected rows,
     but must never collectively claim more than the catalogue contains. */
  test('the live pipeline files every non-rejected row into its expected column', async ({ page, login }) => {
    await login.asAdmin();
    const { content } = await openConsole(page);
    await openTab(page, 'Pipeline');

    /* The header counts rejected records and the board intentionally does not, so derive the board's eligible
       count from the exact response the page rendered — that is what makes an unmapped stage observable. */
    const stages = [
      ['contacted', 'Contacted'],
      ['info_collected', 'Info Collected'],
      ['listed', 'Listed'],
      ['docs_submitted', 'Docs Submitted'],
      ['under_review', 'Under Review'],
      ['live', 'Live'],
    ];
    const expected = Object.fromEntries(stages.map(([key]) => [key, 0]));
    for (const listing of content) {
      if (listing.archived || listing.status === 'rejected') continue;
      const requested = listing.status === 'approved'
        ? 'live'
        : listing.adminPipeline?.pipelineStage || 'under_review';
      expected[requested in expected ? requested : 'under_review'] += 1;
    }
    expect(Object.values(expected).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);

    for (const [key, label] of stages) {
      const header = page.locator('.rounded-xl', { has: page.getByText(label, { exact: true }) }).first();
      const actual = Number((await header.locator('.tabular-nums').first().innerText()).trim());
      expect(actual, `${label} column disagreed with the response the board rendered`).toBe(expected[key]);
    }
  });
});
