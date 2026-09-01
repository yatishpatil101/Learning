import { expect, test, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';
import { appReady } from '../../helpers/app.js';

/**
 * LIVE: the properties console — the screen the supply desk actually works in.
 *
 * ## What this file owns, and why it had to exist separately
 *
 * `live-properties-moderation` proves the four decisions: approve, reject, flag, archive, their
 * refusals, and who may see a listing after each. Those are *routes*. Nobody working the desk ever
 * calls a route — they open `/admin/properties`, read seven numbers off the top of the screen,
 * pick a tab, narrow with a search box, and act on what is left. That page had no live coverage at
 * all. `admin/properties.spec.js` covers it in twenty-eight tests, every one of them against
 * `puneNestDB_v5`: a store in the test's own browser, seeded by the test, read back by the test.
 *
 * The consequence is sharper than "it uses a mock". The mock spec asserts that seven KPI cards
 * render and that clicking each one moves the tab. It cannot assert that any of those seven
 * *numbers is right*, because the only authority on the number was the fixture the test had just
 * written. A console whose Pending tile silently disagreed with the verification queue would pass
 * that suite in full, and it is precisely the failure that matters: the tile is what tells a
 * moderator whether there is work today.
 *
 * So the load-bearing test here is `the KPI tiles and the row counter agree with the listings the
 * server returned`. It intercepts the page's own `GET /api/admin/properties` response, recomputes
 * the five derivable counters from that exact payload using the rules in `AdminProperties`'s
 * `counts` memo, and compares them with what got painted. Nothing is hardcoded and nothing is
 * asserted as a magnitude, which is what makes it survivable on a database three other specs are
 * writing to at the same time.
 *
 * ## What it deliberately leaves alone
 *
 * *The four decisions.* Approving from this modal, rejecting with a reason, clearing a flag —
 * `live-properties-moderation` already pins all of it at the route, including the two transitions
 * `/status` refuses. Re-asserting them through the UI would double the runtime and halve the
 * signal. This file opens the review modal and asserts that everything an approval decision needs
 * is *in front of the operator*; it does not press the button.
 *
 * *The Duplicates tab and its KPI.* There is no server behind either. `findDuplicateClusters` and
 * `resolveDuplicate` in `frontend/src/lib/data/properties-admin.js` run a union-find over the local
 * store and archive the loser into `localStorage`; the backend has no cluster route and no merge
 * route. So the tile is counted here (it is one of the seven that must render) but never clicked,
 * and the tab is named in the strip but never opened — a live test of either would be a test of
 * `localStorage`, dressed up.
 *
 * That is also the reason **`admin/properties.spec.js` must not be deleted once this file lands**.
 * Duplicate detection, the Pipeline board's stage writes and the seeded-catalogue shapes several of
 * its tests depend on are still only exercised there. This file is a twin, not a replacement.
 *
 * ## Fixtures
 *
 * Every listing in this file is created by the test that needs it, under an owner with a mobile no
 * other run will use, and rejected again in `afterEach`. The live database is shared with other
 * sessions and is not reset between runs, so a pending row left behind is not tidy-up debt — it is
 * a row on somebody's real verification queue.
 *
 *   cd e2e; npx playwright test tests/admin/live-properties-console.spec.js --config=playwright.live.config.js
 */

/* `PAGE_LIMIT` in `pages/admin/properties/constants.js`. Only the first fifteen rows of a filtered
   set are rendered, which is why every assertion below that looks for a specific card first narrows
   the list to it by search — on a shared catalogue, "my row is not on screen" and "my row is on
   page two" are the same pixels. */
const PAGE_LIMIT = 15;

/** The strip, in render order, from `tabItems`. Two of the nine carry a count when one is non-zero. */
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
const KPI_LABELS = ['Total', 'Active', 'Pending', 'Flagged', 'Re-check', 'Duplicate', 'Featured'];

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
 * The one console error this screen is allowed to emit, and why it is filtered rather than fixed.
 *
 * `listForModeration` fetches `size=100` and `warnIfTruncated` reports through `console.error` when
 * the catalogue is larger than that — deliberately loud, because every client-side aggregate over
 * the result is then partial (register item 33). On a shared live database that has been accumulating
 * test listings, it is a statement about the *size of the database*, not about the console under
 * test, and it would turn the no-errors assertion into a clock that goes off on a fixed date.
 *
 * Anchored to the exact wording so it cannot swallow anything else. If the app throws for any other
 * reason, the assertion still fails.
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
 * A pending listing with a title no other row can match, under an owner nobody else shares.
 *
 * Created through the owner's own route rather than by an admin write, because "pending" has to be
 * the state the *server* puts a new submission in — that is the premise every verification-queue
 * assertion below rests on, and a fixture that forced the status would keep passing after the
 * server stopped producing it.
 *
 * Returns both handles the tests need, because they are different strings: `id` is the uuid the
 * moderation routes bind, and `label` is what `propertyMapper` will call the row's `id` on screen
 * (`slug || id`), which is what the review modal prints under "Listing ID".
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
 * Take this file's listings back out of the working queue.
 *
 * Rejection rather than deletion, because there is no delete: the platform keeps a moderated
 * listing and records the decision, which is the whole point of the audit row. A rejected listing
 * leaves the verification queue, leaves the public site, and stops counting towards Pending — which
 * is the state a shared queue needs it in.
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
 * Open the console and hand back the payload it rendered from.
 *
 * Waiting on the response rather than on the page settling, and returning it, are the same
 * decision: `AdminProperties` renders `<Loading />` until `all` is non-null, so a screen that never
 * got an answer and a screen mid-flight are indistinguishable — and every count on it is derived
 * from this one body, so a test that fetched the queue *separately* to compare against would be
 * racing whatever another session did in between. The bytes the component rendered from are the
 * only honest baseline.
 *
 * The `/api/` prefix on the matcher is load-bearing. This screen lives at `/admin/properties`, so a
 * bare `/properties` pattern also matches the page's own document request and the wait resolves on
 * the navigation itself — the test then races the very fetch it meant to wait for, and fails with a
 * sentence about missing listings rather than about timing.
 *
 * The second half excludes the re-check queue's fetch, which is the same endpoint with
 * `recheck=true` and lands at roughly the same moment.
 *
 * The wait is armed *after* the navigation commits, not before it, and that ordering is
 * load-bearing. Arming first is the more obvious shape and it is wrong here: the admin shell the
 * test is already sitting on fetches this same endpoint, so the waiter can settle on that older
 * request — and then `goto` tears its document down, taking the body with it. What surfaces is
 * `Protocol error (Network.getResponseBody): No resource with given identifier found` at the
 * `res.json()` line, which reads like a transport fault in the helper rather than what it is: a
 * response belonging to a page that no longer exists. It failed roughly one run in fifteen, moving
 * between tests, because it depended on whether a shell fetch happened to be in flight.
 *
 * `waitUntil: 'commit'` returns as soon as the new document is installed, which is well before the
 * bundle has booted and issued this fetch, so nothing is missed by arming at that point.
 */
async function openConsole(page, search = '') {
  await page.goto(`/admin/properties${search}`, { waitUntil: 'commit' });
  const res = await page.waitForResponse(
    (r) => r.url().includes('/api/admin/properties')
      && !r.url().includes('recheck')
      && r.request().method() === 'GET',
  );
  expect(res.status()).toBe(200);
  const payload = await res.json();
  await appReady(page);
  await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
  return payload;
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
 * Pick an option from `components/ui/Select`, which is not a `<select>`.
 *
 * It is a button plus a portalled listbox, so `selectOption` throws and a plain click on the option
 * can land before the portal has mounted. The `aria-expanded` assertions either side are what make
 * this deterministic: open, choose, closed.
 */
async function pickOption(page, ariaLabel, optionText) {
  const trigger = page.getByRole('button', { name: ariaLabel });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.pn-dropdown__option', { hasText: optionText }).first().click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toContainText(optionText);
}

test.describe('LIVE: the properties console', () => {
  test('the console opens for an administrator and renders clean', async ({ page, login, consoleErrors }) => {
    await login.asAdmin();
    await openConsole(page);

    /* The subtitle distinguishes the full console from the cut-down one an account without
       `properties:write` gets, which has a different sentence and no KPI row at all. Asserting it
       is asserting which of the two screens loaded. */
    await expect(page.getByText('Manage, verify and curate every listing')).toBeVisible();
    /* And the strip below it, which only renders once `all` is non-null — so this is also the
       evidence that the fetch resolved into a rendered screen rather than into a spinner. */
    await expect(page.getByRole('tab')).toHaveCount(TABS.length);

    expect(realErrors(consoleErrors)).toEqual([]);
  });

  test('the strip is exactly the nine supply tabs, and All Listings is the default', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);

    /* Order matters as much as membership. This strip is a workflow read left to right — everything,
       then what needs a decision, then what needs chasing — and a tab that quietly moves changes
       which one a moderator's muscle memory hits first. Two of the nine carry a live count in their
       label, which is why these are patterns rather than strings. */
    const labels = await page.getByRole('tab').allInnerTexts();
    expect(labels).toHaveLength(TABS.length);
    TABS.forEach((pattern, i) => expect(labels[i].trim()).toMatch(pattern));

    /* Landing anywhere other than All Listings would mean the console had an opinion about what the
       operator came here to do. It has not; the opinion belongs to the KPI tiles. */
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(tab(page, 'All Listings')).toHaveAttribute('aria-selected', 'true');
  });

  test('switching tabs moves the selection and the URL follows it', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);

    await openTab(page, 'Verification Queue');

    /* Exactly one selected tab, not "the new one is selected". A strip that added a selection
       instead of moving it looks correct in a screenshot and is unreadable to a screen reader, and
       it is the failure mode of every tab implementation that stores a set instead of a value. */
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(tab(page, 'All Listings')).toHaveAttribute('aria-selected', 'false');

    /* The URL is the half that makes this console shareable. `useTabParam` writes `?tab=` with
       `replace: true`, so a moderator who pastes their address bar into a thread sends the queue
       they were looking at rather than the front page of the console. */
    await expect(page).toHaveURL(/[?&]tab=verify\b/);
  });

  test('a deep link opens the tab it names', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page, '?tab=featured');

    /* The other direction of the same contract, and the one that actually gets used: the link a
       colleague was sent has to resolve to the tab, not to the default with a stale query string
       hanging off it. */
    await expect(tab(page, 'Featured')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  });

  test('all seven KPI tiles render, and each server-backed one jumps to its queue', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);

    for (const label of KPI_LABELS) {
      await expect(page.getByTitle(`View ${label} listings`)).toBeVisible();
    }

    /* The tiles are the console's navigation for anybody who came here because a number looked
       wrong, so each one has to land on the list that explains it. `Pending` is the interesting
       case: it counts `status === 'pending'` but jumps to the *Verification Queue* rather than to
       All Listings filtered by status, and those are two different lists — the queue ignores the
       archived flag. A tile that jumped to the wrong one would send a moderator to a count that
       does not match the tile they clicked.

       `Duplicate` is missing from this table on purpose. Its tab has no server behind it at all —
       see the header — so clicking it would take this spec into `localStorage`. */
    const jumps = [
      ['Total', 'All Listings', /[?&]tab=all\b/],
      ['Active', 'All Listings', /[?&]tab=all\b/],
      ['Pending', 'Verification Queue', /[?&]tab=verify\b/],
      ['Flagged', 'Flagged', /[?&]tab=flagged\b/],
      ['Re-check', /^Re-check Queue/, /[?&]tab=recheck\b/],
      ['Featured', 'Featured', /[?&]tab=featured\b/],
    ];

    for (const [label, tabName, url] of jumps) {
      await page.getByTitle(`View ${label} listings`).click();
      await expect(tab(page, tabName)).toHaveAttribute('aria-selected', 'true');
      await expect(page).toHaveURL(url);
    }
  });

  test('the KPI tiles and the row counter agree with the listings the server returned', async ({ page, login }) => {
    /* The test the mock structurally could not write, and the reason this file exists.
       A pending listing is created first so the Pending tile is provably counting something real
       rather than passing on a zero it agrees with by coincidence. */
    const subject = await pendingListing(`kpi ${Date.now().toString(36)}`);

    await login.asAdmin();
    const payload = await openConsole(page);

    const rows = payload.content;
    expect(Array.isArray(rows)).toBe(true);
    /* The premise. If the subject is not in the body the page rendered from, every comparison below
       would still pass while proving nothing about a listing this test can account for. It is the
       newest row in a `createdAt,desc` page of a hundred, so its absence would be a real finding. */
    expect(rows.some((p) => p.id === subject.id)).toBe(true);

    /* Recomputed from the exact bytes the component rendered from, by the rules in its own `counts`
       memo — archived rows are skipped entirely, and `Under Review` is counted as pending because
       the mock's vocabulary survives in the guard. Deriving rather than re-fetching is what makes
       this safe on a database another session is writing to: a second read could legitimately
       disagree with the first, and the disagreement would be reported as a broken tile. */
    const live = rows.filter((p) => p.archived !== true);
    const expected = {
      Total: live.length,
      Active: live.filter((p) => p.status === 'approved').length,
      Pending: live.filter((p) => p.status === 'pending' || p.status === 'Under Review').length,
      Flagged: live.filter((p) => p.status === 'flagged').length,
      Featured: live.filter((p) => p.featured === true).length,
    };
    expect(expected.Pending).toBeGreaterThan(0);

    for (const [label, value] of Object.entries(expected)) {
      expect(await kpiValue(page, label), `the ${label} tile disagrees with the queue it counts`).toBe(value);
    }

    /* `Re-check` and `Duplicate` are not in that table because neither is derivable from this
       payload — one comes from a second request, the other from the browser's own store. They still
       have to paint a number: a tile rendering `NaN` or nothing is how a broken count first shows
       itself. */
    expect(Number.isFinite(await kpiValue(page, 'Re-check'))).toBe(true);
    expect(Number.isFinite(await kpiValue(page, 'Duplicate'))).toBe(true);

    /* And the counter beside the search box, which is the same claim one layer down: `N of M`,
       where M is everything fetched and N is what survived the filters. With no filters set, N is
       the non-archived population — i.e. the Total tile — so a console whose list and whose tiles
       disagreed would be caught here even if both were internally consistent. */
    await expect(page.getByText(`${expected.Total} of ${rows.length} listings`)).toBeVisible();

    /* The list itself never renders more than fifteen, and says so rather than silently truncating.
       An operator who cannot tell a short list from a paged one works the wrong queue. */
    if (expected.Total > PAGE_LIMIT) {
      await expect(cards(page)).toHaveCount(PAGE_LIMIT);
      await expect(page.getByText(`Showing ${PAGE_LIMIT} of ${expected.Total}`)).toBeVisible();
    }
  });

  test('search finds a listing by title, and an unmatchable term empties the list', async ({ page, login }) => {
    const subject = await pendingListing(`search ${Date.now().toString(36)}`);

    await login.asAdmin();
    const payload = await openConsole(page);
    const total = payload.content.filter((p) => p.archived !== true).length;

    /* Searching for a tag no other row can contain is what makes this assertion exact on a shared
       catalogue: the expected result is one, not "fewer than before". The mock could compare
       against a count it had just seeded; here the only thing this test knows for certain about the
       database is the row it put in it. */
    const search = page.getByPlaceholder('Search title, owner, locality');
    await search.fill(subject.tag);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(subject.title);
    await expect(page.getByText(`1 of ${total} listings`)).toBeVisible();

    /* The empty state is a product decision, not a fallback: a search that matched nothing has to
       say so. Rendering the unfiltered list instead — which is what a filter that silently ignores
       an unmatched term does — is how a moderator acts on the wrong listing. */
    await search.fill(`zztest-nothing-can-match-${Date.now()}`);
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByText('No listings match your filters')).toBeVisible();
    await expect(page.getByText(`0 of ${total} listings`)).toBeVisible();
  });

  test('the status, deal and date filters each narrow the list', async ({ page, login }) => {
    const subject = await pendingListing(`filters ${Date.now().toString(36)}`);

    await login.asAdmin();
    await openConsole(page);

    /* Every filter below is asserted against a listing whose deal, status and age this test set
       itself, with the search box already narrowing to it. That is deliberate: the mock twin
       asserted that a filter *changed the count*, which a filter that dropped everything would also
       satisfy. Here each control has to keep exactly the row it should keep and drop exactly the
       row it should drop, and because the set is one row deep the assertion cannot be confounded by
       the fifteen-row page limit. */
    await page.getByPlaceholder('Search title, owner, locality').fill(subject.tag);
    await expect(cards(page)).toHaveCount(1);

    // Status. A new submission is pending, and pending is not approved.
    await pickOption(page, 'Filter by status', 'Approved');
    await expect(cards(page)).toHaveCount(0);
    await pickOption(page, 'Filter by status', 'Pending');
    await expect(cards(page)).toHaveCount(1);
    await pickOption(page, 'Filter by status', 'All statuses');

    // Deal. `DealPills` is a button group, not a select — it writes `fDeal` straight through.
    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    await expect(cards(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Rent', exact: true }).click();
    await expect(cards(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'All', exact: true }).first().click();

    /* Date. `7d`, not `Today`, and the reason is a real edge rather than caution: `propertyMapper`
       slices `createdAt` to `YYYY-MM-DD`, so a row created minutes ago compares as midnight UTC of
       its own date. Between 00:00 and 05:30 IST that is more than twenty-four hours behind `now`,
       and a `Today` filter would drop a listing this test had just created — a flake that only
       fires overnight. A seven-day window has no such boundary. */
    await page.getByRole('button', { name: '7d', exact: true }).click();
    await expect(cards(page)).toHaveCount(1);
  });

  test('the verification queue offers a case file with everything an approval decision needs', async ({ page, login }) => {
    const subject = await pendingListing(`review ${Date.now().toString(36)}`);

    await login.asAdmin();
    await openConsole(page, '?tab=verify');
    await expect(tab(page, 'Verification Queue')).toHaveAttribute('aria-selected', 'true');

    /* Narrowed to this test's own listing rather than reviewing whatever happens to be first. On a
       shared queue "the first card" is another session's work item, and opening a case file against
       it writes a reviewer claim onto a listing this test has no business touching. */
    await page.getByPlaceholder('Search title, owner, locality').fill(subject.tag);
    await expect(cards(page)).toHaveCount(1);

    /* The case file is a real server object — `startPropertyReview` is idempotent and creates it on
       open — so this click is a write, and waiting on the response is what separates "the modal
       rendered" from "the modal rendered something the server knows about". */
    await cards(page).getByRole('button', { name: 'Review', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Verify property' });
    await expect(dialog).toBeVisible();

    /* Scoped by accessible name throughout. `getByRole('dialog')` alone is never unique on this app
       — the cookie banner is one — so an unscoped query is a coin toss that happens to land right
       on a clean profile. */

    // Which listing. The modal prints `slug || id`, which for an unfiled new submission is the uuid.
    await expect(dialog).toContainText(subject.title);
    await expect(dialog).toContainText('Listing ID');
    await expect(dialog).toContainText(subject.label);

    /* What the decision is made from. The checklist is the case file's own state, so the ratio is
       the evidence that the fetch resolved rather than that a component rendered a heading; the
       details grid is what a moderator checks the photos against; and the owner thread is how they
       ask before rejecting. A modal missing any one of them turns approval into a guess. */
    await expect(dialog).toContainText('Verification checklist');
    await expect(dialog).toContainText(/\d+ \/ \d+ checked/);
    await expect(dialog).toContainText('Property details');
    await expect(dialog).toContainText('Communicate with the owner');

    /* Both decisions, side by side, and the rejection is the one that has to be two steps: the
       button reads `Reject…` until a reason has somewhere to go. `live-properties-moderation` owns
       what each verb does to the listing; this owns that the operator is offered both rather than
       being funnelled towards approval. */
    await expect(dialog.getByRole('button', { name: 'Approve & publish' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Reject' })).toBeVisible();

    /* Closing has to actually remove it. A modal left in the DOM behind an opacity change keeps
       focus and keeps its buttons clickable, so the next thing the operator types goes into a
       listing they thought they had put down. */
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('Export CSV downloads a file named for the active tab', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);

    /* The filename is the whole feature. These exports go into a spreadsheet next to four others
       pulled the same afternoon, and `punenest-listings.csv` sitting where the verification queue
       should be is a report about the wrong population that nobody can tell apart afterwards. */
    const expected = [
      ['All Listings', 'punenest-listings.csv'],
      ['Verification Queue', 'punenest-verification-queue.csv'],
      ['Flagged', 'punenest-flagged.csv'],
      ['Featured', 'punenest-featured.csv'],
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

    /* This tab is the console's answer to "what has gone quiet", and its sub-filter is the only
       place the three ways a listing stalls are named apart: waiting on us, waiting on the owner,
       or live but unconfirmed. They need different actions, so a desk that cannot separate them
       chases the wrong people.

       The list itself is not asserted — whether anything is currently stale is a fact about the
       shared database on the day, and pinning it would make this spec fail for a reason that has
       nothing to do with the screen. The regex is anchored so it matches the counter span itself
       rather than every ancestor that happens to contain it. */
    await expect(page.getByText(/^\d+ listings$/)).toBeVisible();

    const trigger = page.getByRole('button', { name: 'Filter by reason' });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    for (const reason of ['All reasons', 'Stale pending', 'Awaiting owner', 'Unconfirmed (stale)']) {
      await expect(page.locator('.pn-dropdown__option', { hasText: reason })).toHaveCount(1);
    }

    /* Chosen from the menu that is already open, rather than through `pickOption`. That helper
       starts by clicking the trigger, and a click on an open `components/ui/Select` closes it — so
       calling it here would have shut the dropdown and then waited fifteen seconds for the
       `aria-expanded="true"` that its own click had just undone. Reading the failure, it looks like
       the component refusing to open; it is really the test opening it twice. */
    await page.locator('.pn-dropdown__option', { hasText: 'Unconfirmed (stale)' }).first().click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toContainText('Unconfirmed (stale)');
    // Whichever way it lands, the tab has to say something: a blank pane reads as a broken fetch.
    await expect(
      page.locator('.pn-card').filter({ hasText: /haven't confirmed availability|All caught up/ }).first(),
    ).toBeVisible();
  });

  /*
     The Staff Posted tab, which had no live cover at all.

     `post-on-behalf.spec.js` claimed it, in a test that posted a listing through the six-step
     wizard and then looked for it under the tab. Against the mock that worked, and it worked for a
     reason that does not survive the move: the console used to pack `postedByStaff: <display name>`
     into the create body, the mock provider stored the object it was handed verbatim, and the tab
     filtered on the field it had just written. Client, store and assertion were the same sentence
     three times.

     The server does not accept that field. It takes the staff id from the caller's token — see
     `the funnel is opened, and it names the staff member by id` in `live-post-on-behalf.spec.js` —
     so live, `postedByStaff` is a uuid that arrived from somewhere the browser has no say over. The
     interesting question is therefore whether the tab still finds anything, and it is a question the
     mock could not be wrong about.

     One more thing the old test asserted and should not have: `getByText('Administrator').first()`,
     under a comment about a "Posted By column with staff name". There is no such column — the staff
     tab renders the same card list as every other tab — and "Administrator" is the signed-in name
     printed in the admin topbar on every page of the console. It matched the chrome. It would have
     matched on the tab being empty, on the tab not existing, and on a completely different screen.
  */

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
    /* The row that makes the exclusion mean something. It is pending, in Baner, created seconds
       apart from the one above and by the same `BASE_LISTING` — identical on every axis this tab
       does not filter on, so the only reason it can be missing below is the one under test. Without
       it, deleting the `postedByStaff` filter would leave this test green. */
    const owner = await pendingListing(`self ${tag}`);

    await login.asAdmin();
    await openConsole(page, '?tab=staff');
    await expect(tab(page, 'Staff Posted')).toHaveAttribute('aria-selected', 'true');

    /* Present, first. An absence asserted before anything has been shown to render is a statement
       about an empty pane, and this tab starts empty on every page load. */
    const search = page.getByPlaceholder('Search title, owner, staff name');
    await search.fill(desk.tag);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(desk.title);

    // Then absent, on the same tab, through the same box.
    await search.fill(owner.tag);
    await expect(cards(page)).toHaveCount(0);

    /* And the third leg, which is what turns that zero into evidence: the owner's listing *is* in
       the catalogue and *is* findable by this exact string. Without this, a typo in the tag, a
       creation that silently failed, or a console that had stopped rendering cards at all would all
       read as a working filter. */
    await openTab(page, 'All Listings');
    await page.getByPlaceholder('Search title, owner, locality').fill(owner.tag);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(owner.title);
  });

  test('a concierge listing is drawn with the hand-back pipeline an owner submission never gets', async ({ page, login }) => {
    /* `postedByAdmin` is the other half of the same wire hop, and it is the one with a visible
       consequence: `AdminPropertyCard` picks between two entirely different progress rows with it.
       A desk listing is tracked through the hand-back — has the owner sent their Aadhaar, are the
       photos in — because the desk is chasing a person who has not seen the listing yet. An owner
       submission is tracked through review, because the owner has already done their part.

       If the field is lost in the mapper it defaults to `false`, and every concierge listing on the
       console silently renders as if the owner had filed it themselves: the moderator sees "In
       Review" on a row whose actual blocker is an owner who has not answered the phone. Nothing
       errors, and no count changes — which is why it needs asserting from both sides. */
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

  test('a signed-in buyer cannot reach the console', async ({ page, login }) => {
    /* `RoleRoute` is the gate and it is role-based, not atom-based: a consumer session is bounced
       out of the shell entirely rather than shown a console whose every fetch 403s. The API half of
       this — `GET /admin/properties` refusing a non-staff token — belongs to the moderation spec;
       this is the half that decides what the person sees. */
    await login.asBuyer();
    await page.goto('/admin/properties');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin/properties'));
    expect(new URL(page.url()).pathname).not.toBe('/admin/properties');
  });

  test('a signed-out visitor is sent to the staff sign-in', async ({ page }) => {
    /* And the redirect has to be `/staff-login`, not `/signin`. A moderator who has been logged out
       mid-shift and lands on the consumer sign-in will sign in as themselves and get a consumer
       session, which fails the role check they were just bounced for — the loop looks like a broken
       account rather than a wrong door. `next` carries the page they were trying to reach so the
       correct sign-in returns them to it. */
    await page.goto('/admin/properties');
    await page.waitForURL(/\/staff-login/);
    expect(new URL(page.url()).pathname).toBe('/staff-login');
  });
});
