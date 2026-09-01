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
 * calls a route — they open `/admin/properties`, read the numbers off the top of the screen,
 * pick a tab, narrow with a search box, and act on what is left. That page had no live coverage at
 * all. `admin/properties.spec.js` covers it in twenty-eight tests, every one of them against
 * `puneNestDB_v5`: a store in the test's own browser, seeded by the test, read back by the test.
 *
 * The consequence is sharper than "it uses a mock". The mock spec asserts that seven KPI cards
 * render and that clicking each one moves the tab. It cannot assert that any of those seven
 * *numbers is right*, because the only authority on the number was the fixture the test had just
 * written. A console whose Pending tile silently disagreed with the verification queue would pass
 * that suite in full, and it is precisely the failure that matters: the tile is what tells a
 * moderator whether there is work today. The Duplicate tile below is the same failure, caught:
 * seven tiles rendered, seven tiles were asserted, and one of them was answering a question about
 * a fixture.
 *
 * So the load-bearing test here is `the KPI tiles and the row counter agree with the listings the
 * server returned`. It intercepts the page's own `GET /api/admin/properties` response, recomputes
 * the five derivable counters from that exact payload using the rules in `AdminProperties`'s
 * `counts` memo, and compares them with what got painted. Nothing is hardcoded and nothing is
 * asserted as a magnitude, which is what makes it survivable on a database three other specs are
 * writing to at the same time.
 *
 * ## The writes, added late (D250)
 *
 * The section below used to begin "*The four decisions.* … it does not press the button", and that
 * stood for as long as it took to count the tests: sixteen, and every one of them a read. On a
 * moderation console. The argument for it was that `live-properties-moderation` pins the decisions
 * at the route, which is true and is not the same claim — a route that works behind a button that
 * never sends is exactly the shape of failure nobody notices, because the toast fires either way.
 * The mock twin could not close it: its clear-flag regression asserts that a flagged card appears
 * on the Flagged tab, which is a claim about a store the browser owns.
 *
 * So two of them are pressed now, chosen because they are the two the desk uses most and the two
 * with the least server feedback: `flagging a listing is a decision the server keeps, and clearing
 * it publishes again`, and `moving a card across the pipeline board is a stage the server stores`.
 * Both act through the UI on a listing the test created and searched down to a single card, then
 * re-read `GET /admin/properties` over a separate connection — the only faithful re-read available,
 * since `GET /properties/{id}` enforces the public floor and 404s for anything flagged or pending.
 * Both were mutation-proven by no-opping the http provider's `flagListing` and `setPipelineStage`:
 * each went red on the server assertion while the UI carried on reporting success.
 *
 * Two details worth keeping. `clearFlag` sets `approved` *unconditionally* rather than restoring
 * the previous status, so the flag test approves the listing first — otherwise the final assertion
 * would agree with the server for the wrong reason. And the stage test asserts the row was **not**
 * already in the stage it moves to, which is not decoration: concierge listings are created at
 * `listed`, the first draft moved one to `listed`, and that guard is what caught it.
 *
 * ## What it deliberately leaves alone
 *
 * *The other two decisions.* Approving from this modal and rejecting with a reason —
 * `live-properties-moderation` already pins both at the route, including the two transitions
 * `/status` refuses. This file opens the review modal and asserts that everything an approval
 * decision needs is *in front of the operator*; it does not press those two.
 *
 * *The Duplicates tab and its KPI — removed from live builds, then rebuilt properly (D255).* An
 * earlier revision of this header read: "the tile is counted here (it is one of the seven that must
 * render) but never clicked, and the tab is named in the strip but never opened — a live test of
 * either would be a test of `localStorage`, dressed up." Every word of that was true, and the
 * conclusion drawn from it was wrong. `findDuplicateClusters` and `resolveDuplicate` in
 * `frontend/src/lib/data/properties-admin.js` ran a union-find over the fixture store and archived
 * the loser into `localStorage`; the backend had no cluster route and no merge route. What was
 * missed is that the store is seeded on a live build too — `main.jsx` calls `ensureMockDb()`
 * unconditionally — so the tile did not sit blank waiting for a backend. It rendered a **0**.
 * Measured against this lane's database: `Duplicate listings: 0` while `GET /admin/properties`
 * returned 71 rows containing four repeated titles, one of them four times over.
 *
 * A test that cannot honestly click a control is evidence about the control, not about the test.
 * So the tile and the tab came out of live builds, and this file asserted their absence — until the
 * server grew the missing half. `GET /admin/properties/duplicates` now derives the clusters, and
 * merge and dismiss are audited server writes. The strip below is nine tabs again and the tile is
 * back among `KPI_LABELS`; what the control *does* is proven in `live-duplicates.spec.js`, which
 * seeds a real collision over the wire rather than trusting a count.
 *
 * That is also the reason **`admin/properties.spec.js` must not be deleted once this file lands**.
 * Seeded-catalogue shapes several of its tests depend on are still only exercised there. This file
 * is a twin, not a replacement. (Its "Pipeline board's stage writes" used to be on that list; they
 * are covered live now, and the mock file's header records why they were the worst item on it.
 * Duplicate detection has just left that list too.)
 *
 * ## Fixtures
 *
 * Every listing in this file is created by the test that needs it, under an owner with a mobile no
 * other run will use, and rejected again in `afterEach`. The live database is shared with other
 * sessions and is not reset between runs, so a pending row left behind is not tidy-up debt — it is
 * a row on somebody's real verification queue.
 *
 *   cd e2e; npx playwright test tests/admin/live-properties-console.spec.js --config=playwright.config.js
 */

/* `PAGE_LIMIT` in `pages/admin/properties/constants.js`. Only the first fifteen rows of a filtered
   set are rendered, which is why every assertion below that looks for a specific card first narrows
   the list to it by search — on a shared catalogue, "my row is not on screen" and "my row is on
   page two" are the same pixels. */
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
/**
 * True only for the All Listings fetch — the unfaceted read the console's `all` array is built
 * from.
 *
 * This used to be a substring test (`includes('/api/admin/properties')` minus a hand-kept list of
 * excluded words) and it kept losing races, because a prefix matches every sibling the screen
 * fetches on mount: `/recheck` did, then `/duplicates` did, and when the five per-queue reads
 * landed here they did too — `?status=pending`, `?featured=true`, `?postedByAdmin=true` and the
 * rest all satisfy the prefix, are GET, and contain none of the excluded words. Six responses
 * matched, whichever arrived first won, and the symptom was a *different* test failing each run:
 * one run the deep-link test, the next the KPI test asserting a freshly minted row was in `rows`
 * — because `rows` was some other queue's body.
 *
 * The exclusion list was the flaw, not its contents: every queue added later has to be remembered,
 * and forgetting one costs a wandering failure that reads as page flakiness. So this matches
 * *positively* instead. The All fetch is `listForModeration({}, 'newest')`, and `toQuery` drops
 * every undefined filter, so it is the only read of this exact path carrying nothing but paging
 * and sort. Any facet — existing or added next week — puts a key in the query string and takes the
 * request out of scope automatically, with no list to maintain.
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
    page.waitForResponse(isAllListingsFetch),    /* The bytes the KPI strip renders from, captured here rather than re-fetched in the test.
       Re-fetching would be a second read of a database three other specs are writing to, and any
       legitimate drift between the two reads would surface as "a tile is wrong". Same discipline as
       the list payload above, and the same reason. */
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
       label, which is why these are patterns rather than strings.

       Nine, not eight: `Duplicates` was gated out of live builds while it had no server behind it,
       and came back in D255 when it got one. `TABS` is the exact strip, so this assertion is also
       what would catch it disappearing again. */
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

  test('all seven KPI tiles render and each jumps to its queue', async ({ page, login }) => {
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
       does not match the tile they clicked. */
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

    /* `Duplicate` is the seventh tile, and for four releases it was not here at all. This spec
       originally skipped it with the note that clicking it "would take this spec into
       `localStorage`"; that was the right diagnosis attached to the wrong remedy, because a tile a
       live test cannot honestly click is a tile a live operator cannot honestly read. Measured then,
       it displayed `Duplicate listings: 0` against a catalogue of 71 rows carrying four repeated
       titles — a clean bill of health issued by a union-find over `db.json`. It was removed, and is
       back now only because `GET /admin/properties/duplicates` exists to answer it.

       What this test pins is the tile and its jump. It deliberately asserts nothing about the
       *number*, which on a shared catalogue is whatever other sessions have left lying around;
       `live-duplicates.spec.js` seeds a known collision and follows it through the merge. */
  });

  test('a bookmarked ?tab=duplicates opens the duplicates tab', async ({ page, login }) => {
    /* This used to assert the opposite — that the deep link degraded to All Listings, because the
       tab key was filtered out of `useTabParam`'s valid list on a live build. It is a real tab
       again, so the bookmark resolves to it. Kept as a test rather than deleted with the gate: the
       deep link is how one moderator sends another a queue, and it is the half of `useTabParam`
       that the "switching tabs writes the URL" test above does not cover. */
    await login.asAdmin();
    await page.goto('/admin/properties?tab=duplicates');

    await expect(tab(page, /^Duplicates/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
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

    /* The tiles are the database's counts over the whole catalogue, taken from the exact
       `/summary` body the strip rendered from.

       This assertion used to be the other way round: it recomputed the five counters from `rows` —
       the page the console had just fetched — and compared the tiles to that. It passed for as long
       as it existed, and it passed while the strip displayed **Active 0** over 54 approved
       listings, because the console and the test were making the same mistake. Both counted a
       capped page and called the result the catalogue. A test that derives its expectation the same
       way the code does cannot fail on the thing they agree about, however exact it looks. */
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

    /* The anti-regression clause, and the only part of this test that knows the old bug by name.
       When the catalogue is bigger than the page — which is the only condition under which the two
       readings can differ at all — the Total tile must not be the page-local count. Restoring the
       `useMemo` over `all` fails here specifically, rather than merely disagreeing with a number
       that could have drifted for some other reason. */
    const pageLocalTotal = rows.filter((p) => p.archived !== true).length;
    if (s.total > rows.length) {
      expect(await kpiValue(page, 'Total'),
        'the Total tile is counting the fetched page, not the catalogue').not.toBe(pageLocalTotal);
    }

    /* `Duplicate` is deliberately absent from that table. It used to be asserted only as
       `Number.isFinite`, excused as coming "from the browser's own store" — which is the whole
       defect written down: a tile sourced from the browser's store cannot be wrong about the
       server, because it was never about the server. It painted a perfectly finite `0` and passed
       for as long as it existed, and `Number.isFinite` would never have caught it, because a wrong
       number is finite too. It is a server count now and it is proven where a known collision can
       be put into the catalogue and watched: `live-duplicates.spec.js`. What this file pins is that
       the tile exists and navigates, asserted above. */

    /* And the counter beside the search box — the same claim one layer down. With no filters set it
       reads `N of M` where both are the catalogue: N is the rows rendered from this page and M is
       the server's count of everything that matched. It used to print `all.length` for M, so on a
       207-row catalogue it said "of 100" and would have said "of 100" against a million. */
    await expect(page.getByText(`of ${s.total.toLocaleString('en-IN')} listings`)).toBeVisible();

    /* A page smaller than the match is stated outright rather than left to be inferred from a row
       count nobody compares. An operator who cannot tell a short list from a paged one works the
       wrong queue. */
    if (s.total > rows.length) {
      await expect(page.getByTestId('all-truncated')).toBeVisible();
    }
    if (rows.length > PAGE_LIMIT) {
      await expect(cards(page)).toHaveCount(PAGE_LIMIT);
    }

    /* Ported from `properties.spec.js`'s `cards carry the listing title and locality...`, which is
       retired by this test. Two claims lived there that the paragraphs above do not make.

       First, the row count below the cap. The branch above asserts a full page when the match set
       overflows; this asserts the exact count when it does not, so a list that renders *fewer*
       cards than it matched is caught. Without it the only pinned case is the one where the number
       is a constant, and `toHaveCount(15)` passes on a page that dropped every row it could not
       fit as well as on one that dropped rows for no reason at all.

       Second, what a card actually says. The counter agreeing with the server proves the arithmetic
       and nothing about the rendering: a grid of fifteen cards each drawn from a listing whose
       title failed to map would satisfy every assertion above it. The heading is asserted non-empty
       and the locality is asserted to be the one the server sent for that row, matched by id rather
       than by position, because the sort is the server's and reading `rows[0]` assumes it. */
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

    /* The catalogue's true size, from the endpoint the console now reads its counters from. It is
       fetched here rather than counted off the console's own list response on purpose: counting the
       rows the page fetched is precisely the bug this test exists to hold shut. That is not a
       hypothetical either — this assertion used to be written that way, and it passed while the
       screen displayed "1 of 100 listings" against 207 real listings, because both sides of the
       comparison were the same capped page. */
    const summary = await (await fetch(`${API}/admin/properties/summary`, {
      headers: await authHeaders(ACTORS.admin),
    })).json();

    await openConsole(page);

    /* The unfiltered denominator is the whole catalogue. On a database larger than the provider's
       page size these two numbers differ, and only a server-side count can produce the larger one:
       reverting the console to `all.length` renders the page cap here and fails. */
    await expect(page.getByText(`of ${summary.total.toLocaleString('en-IN')} listings`)).toBeVisible();

    /* Searching for a tag no other row can contain is what makes this assertion exact on a shared
       catalogue: the expected result is one, not "fewer than before". The mock could compare
       against a count it had just seeded; here the only thing this test knows for certain about the
       database is the row it put in it. */
    const search = page.getByPlaceholder('Search title, owner, locality');
    await search.fill(subject.tag);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(subject.title);
    /* "1 of 1" — the server counted the match, so the denominator narrows with the query. Under the
       old client-side filter the numerator narrowed and the denominator stayed at the page cap. */
    await expect(page.getByText('1 of 1 listings')).toBeVisible();

    /* The empty state is a product decision, not a fallback: a search that matched nothing has to
       say so. Rendering the unfiltered list instead — which is what a filter that silently ignores
       an unmatched term does — is how a moderator acts on the wrong listing. */
    await search.fill(`zztest-nothing-can-match-${Date.now()}`);
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByText('No listings match your filters')).toBeVisible();
    await expect(page.getByText('0 of 0 listings')).toBeVisible();

    /* Ported from `properties.spec.js`'s `search narrows the list to rows that match`, retired by
       this test. Everything above searches a tag this test minted, which proves the box does not
       exclude too much but says nothing about a term that matches *many* rows — and locality is the
       third of the three fields the placeholder promises. A search that quietly ignored the term
       and returned the unfiltered page would pass every assertion above, because a one-row match on
       a unique tag is indistinguishable from a lucky sort. Here the claim is the shape of the
       result set: every surviving card carries the term, and at least one survives. `Baner` is the
       seeded locality with the most rows, so an empty result is a finding rather than a property of
       the fixture. */
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
    /* Ported from the mock twin: resetting the control has to restore the row, not merely stop
       narrowing. `All statuses` is a real value the console sends, and a reset that dropped it on
       the floor would leave the previous filter latched — invisible, because the select reads
       `All statuses` while the list is still the narrowed one. Asserted on the row rather than on
       the counter so it holds whatever else is in the catalogue. */
    await expect(cards(page), 'clearing the status filter did not restore the row').toHaveCount(1);

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

    /* Ported from the mock twin, and asserted in both directions on purpose. The `N pending` count
       belongs to the verification queue, so it must be absent on All Listings and present once the
       queue is open. Only the second half is usually written, and on its own it is satisfied by a
       counter that renders on every tab — which tells a moderator there is work waiting no matter
       which desk they are standing at. */
    await openConsole(page);
    await expect(page.getByText(/\d+ pending/),
      'the verification backlog is being counted on a tab it does not belong to',
    ).toHaveCount(0);

    await openConsole(page, '?tab=verify');
    await expect(tab(page, 'Verification Queue')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/\d+ pending/)).toBeVisible();

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

  /**
   * The console's decisions, checked against the server rather than against the screen.
   *
   * Everything above this point is a read. That was the gap: this is a moderation console, its
   * entire purpose is to change listings, and until now nothing on a live build asserted that any
   * change survived the request. The mock twin could not close it — `properties.spec.js`'s
   * clear-flag regression asserts that a flagged card shows up on the Flagged tab, which is a claim
   * about a store the browser owns, and it would pass identically against a server that dropped the
   * write on the floor.
   *
   * So each test below acts through the UI and then re-reads `GET /admin/properties` over a
   * separate connection. The listing is one this test created and searched down to a single card,
   * so the re-read is exact rather than statistical, and a server that answered the request without
   * honouring it fails on the row's own `status`.
   */
  test('flagging a listing is a decision the server keeps, and clearing it publishes again', async ({ page, login }) => {
    const subject = await pendingListing(`flag ${Date.now().toString(36)}`);
    const headers = await authHeaders(ACTORS.admin);

    /* Approved first, so the flag is a real transition out of the live catalogue rather than a
       second word for "not published yet". It also matters for the second half: `clearFlag` sets
       `approved` unconditionally, so starting anywhere else would make the final assertion agree
       with the server for the wrong reason. */
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

    /* Ported from the mock twin. The reason box is what the queue is worked from; the note is where
       a moderator puts what they are not willing to publish to the owner. A flag form that offers
       only the first collapses the two, and whatever the moderator would have kept internal either
       goes into the reason — where the owner can read it — or goes unwritten. */
    await expect(flagModal.getByText(/Internal note \(optional\)/i),
      'the flag form no longer offers anywhere to put what the owner should not read',
    ).toBeVisible();

    await flagModal.locator('textarea').first().fill(reason);

    /* And the note is actually written, because the disclosure being *present* is a weaker claim
       than the one the retired mock test `a note filed beside a decision survives the decision`
       made. What that test was really about is read back at the end of this one: a note filed from
       the flag form has to be legible from a *different* modal on the same listing, since the
       moderator who opens it next is as likely to be reaching for Archive as for Flag. A note
       history keyed per-modal, or per-decision, would satisfy everything above and still lose the
       note. */
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

    /* `doClearFlag` guards on `window.confirm`, and Playwright auto-dismisses dialogs — so without
       this handler the click is silently a no-op and every assertion after it reports the *old*
       state as a failure of the write. Accepting once, scoped to this test. */
    page.once('dialog', (d) => d.accept());
    await flaggedCard.getByTitle('Clear flag & publish').click();
    await expect(page.getByText('Flag cleared \u2014 listing published')).toBeVisible();

    /* Back to approved, on the server. This is the half that would silently rot: `clearFlag` is a
       DELETE that answers 204 with no body, so every signal the browser has about it is something
       the browser decided. */
    expect((await serverRow()).status, 'clearing the flag never reached the server').toBe('approved');

    /* The cross-modal read, ported here when `admin/notes.spec.js` was retired. Everything the
       browser knew about that note has been thrown away twice over by now — the flag modal closed,
       the tab changed, the decision was undone — and this reload throws away the rest, so what the
       Archive form draws below is a fresh fetch of the listing's note history rather than anything
       this session is still holding.

       Asserted on the *Archive* modal on purpose. The note was filed from the Flag form; a history
       that is scoped to the form that wrote it, or to the decision it accompanied, would pass every
       assertion made above and still leave the next moderator's screen blank. The `Flagged` label
       is the other half: the note is filed against what was being done at the time, which is what
       makes a bare line of text readable a week later. */
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

    /* The byline, ported from the same retired test. This is the one place it can be checked on a
       listing's own note history: `live-notes.spec.js` proves the server *stores* an author and
       renders one in the user drawer and the communication log, but neither of those is this
       widget. A history that drops the name renders a wall of anonymous lines, which is the state a
       shared note file exists to avoid — and it is exactly what the mock provider used to produce,
       since it had no author to resolve.

       Matched on the role names rather than on a specific person: the login fixture decides who
       took the decision, and pinning this to one account would make it a test of the fixture. */
    await expect(archiveModal.getByText(/Admin|Staff/).first(),
      'the note history shows the words but not who wrote them',
    ).toBeVisible();
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

  /**
   * The unconfirmed queue is a *freshness* predicate, and this is the test that says so.
   *
   * The test above deliberately declines the claim — it accepts `All caught up` or a populated
   * board, because whether anything is stale today is a fact about the shared database. That is the
   * right call for a test about the sub-filter's option set, and it leaves the predicate itself
   * unasserted in both directions. Both directions have already been wrong here:
   *
   *   - Too narrow. The predicate opened `if (!l.real …)`, and `real` is a mock-store field the http
   *     mapper has never emitted, so every live listing failed the first clause. The tab read
   *     "All caught up" over fifty-three listings whose owners had gone silent.
   *   - Too wide is the same bug wearing the other face, and it is the one nothing guards. Drop the
   *     `unconfirmed` parameter from `unconfirmedQueue` and the tab lists *every* approved listing:
   *     a full board, plausible rows, a busy-looking desk — and staff ringing owners who confirmed
   *     this morning. There is no error and no empty state to notice. It reads as work.
   *
   * Converted from `listing-freshness.spec.js`, which asserted this against a listing it had written
   * into `localStorage` with a `freshenedAt` it chose. Freshness is derived from
   * `properties.last_confirmed_at` by `Freshness.unconfirmedBefore`, so the mock file was reading
   * back its own arithmetic and could not have caught either failure above.
   *
   * The discriminator is a listing that is unambiguously *not* stale — one created moments ago —
   * held against a queue that is proven non-empty in the same breath. The listing is approved
   * first, because `unconfirmed` only selects among rows that are approved, un-archived and earning
   * impressions right now; a pending row would be excluded for the wrong reason and the test would
   * pass without the facet doing anything.
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

    /* The narrowing. An unknown query parameter is dropped by Spring without a 400, so a facet that
       had been renamed or never wired would return the full catalogue and every "the queue has rows"
       assertion would still pass. `quiet < live` is the only shape that rules that out. */
    expect(quiet, 'the unconfirmed facet returned the whole live catalogue — it is not narrowing anything')
      .toBeLessThan(live);
    /* …and the other half of the vacuity guard. If the seed ever went entirely fresh, `quiet` would
       be zero, the inequality above would hold trivially, and the screen assertions below would be
       satisfied by a queue that is empty for reasons of its own. */
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

    /* The same term, typed into two boxes on the same console, has to give opposite answers — and
       the only thing that differs between the two requests is the freshness facet. Doing it on
       screen rather than by a third fetch is the point: the queue the operator sees is assembled by
       `unconfirmedQueue`, and it is that hook's parameters, not the endpoint's, that decide who
       gets rung. */
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
       about an empty pane, and this tab starts empty on every page load.

       The placeholder used to say "staff name", and this box used to be able to honour it — against
       the mock, where the console wrote a display name into `postedByStaff` and then searched the
       row it had just written. The live server derives that field from the caller's token, so it
       holds a uuid inside a jsonb map and no staff name was ever matchable. The promise went; a
       real staff-name filter is a `users` join and a query parameter of its own. */
    const search = page.getByPlaceholder('Search title, owner, locality');
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

  test('moving a card across the pipeline board is a stage the server stores', async ({ page, login }) => {
    /* The board's write, checked the same way as the flag above and for the same reason: nothing
       on a live build asserted that dragging a concierge listing along the funnel outlived the
       request. It is also the write most likely to be quietly refused rather than quietly lost —
       `POST /properties/{id}/pipeline` takes eight values and answers 400 for anything else, and
       two of the six columns this board draws (`Under Review`, `Live`) are `status` read sideways
       and are *not* among them. The mock twin asserts that the dropdown does not offer those two,
       which is a claim about a list of strings in the client; this asserts that the four it does
       offer are ones the server accepts. */
    const desk = await conciergeListing(`stage ${Date.now().toString(36)}`);
    const headers = await authHeaders(ACTORS.admin);

    /* `adminPipeline.pipelineStage`, not a top-level field. This read sits *below* the mapper, so
       it has to speak the wire's vocabulary rather than the client's — `propertyMapper` is what
       flattens the nested block into `pipelineStage`, and a probe written in the client's words
       reads `undefined` forever and reports it as a write that never landed. */
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

    /* The card this test owns, not merely the first card on a shared board. `Contacted` is chosen
       for two reasons: it is an acquisition stage, so it lands in `pipeline_stage` rather than in
       `handback_milestone` and the field read back below is the one being written; and a concierge
       listing is *created* at `listed`, so moving it there would have been a write the fixture had
       already made — the `before` guard at the end of this test is what caught that. */
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
   * ---------------------------------------------------------------------------------------------
   * Every queue's horizon is the server's, not the first page's.
   * ---------------------------------------------------------------------------------------------
   *
   * The defect these four tests exist for, measured on this database before the fix (322 listings,
   * `size=100`, newest first):
   *
   *     tab                  server holds   the screen rendered
   *     Verification Queue        91               27
   *     Flagged                    4                0
   *     Featured                   5                0
   *     Staff Posted              67               27
   *
   * The All tab fetched one hundred rows and every other tab filtered *that array* in the browser,
   * so each queue's contents were "the members of this queue that happen to be among the hundred
   * newest listings on the platform" — a sentence nobody would have written down, and one that gets
   * strictly worse as the catalogue grows. Flagged and Featured had crossed the line already: both
   * rendered an empty queue while the KPI tile eighty pixels above them said 4 and 5. A page
   * disagreeing with itself on screen.
   *
   * Each tab now issues its own `GET /admin/properties` with its own facet, so the two assertions
   * below are the two halves of that claim:
   *
   *   (1) the FACET WENT TO THE SERVER — asserted on the request, because it is the only place the
   *       difference is unambiguous. A client that still filtered in the browser would fetch the
   *       unfiltered page and could, on a small enough catalogue, render exactly the right rows.
   *   (2) the SCREEN'S COUNT IS THE SERVER'S COUNT — asserted against `totalElements` from an
   *       independent read of the same facet. This is the half that fails on the old build: 0 vs 5.
   *
   * The fixture is the vacuity guard, and it is deliberately not the thing being proved. Each test
   * mints a row that belongs to its queue, which makes the queue non-empty and gives (1) something
   * to land on — without it, a tab that rendered nothing at all would satisfy every count
   * assertion here on a database that happened to hold nothing. The minted row is by definition the
   * *newest* listing, so it would have been on the old build's page too; it proves the tab renders,
   * not that the horizon moved. Only the count against `totalElements` does that, which is why the
   * test also asserts the server total is larger than what one page could have contributed.
   */
  const QUEUES = [
    { name: 'Verification Queue', facet: 'status=pending', param: 'status=pending', banner: 'verify-truncated', search: 'Search title, owner, locality' },
    { name: 'Flagged', facet: 'status=flagged', param: 'status=flagged', banner: 'flagged-truncated', search: 'Search title, owner, locality' },
    { name: 'Featured', facet: 'featured=true', param: 'featured=true', banner: 'featured-truncated', search: 'Search title, owner, locality' },
    { name: 'Staff Posted', facet: 'postedByAdmin=true', param: 'postedByAdmin=true', banner: 'staff-truncated', search: 'Search title, owner, locality' },
  ];

  /** `PAGE_SIZE` in `services/providers/http/propertyProvider.js` — the cap that caused all of this. */
  const PAGE_SIZE = 100;

  /* The banner prints through `lib/format.js`'s `fmtNum`, which is `en-IN` grouping — 1,00,000 and
     not 100,000. Asserting the raw digits would pass on a three-digit queue and start failing the
     day the catalogue crossed a lakh, which is exactly the kind of expiry date a truncation test
     must not carry. */
  const fmtNum = (n) => Number(n).toLocaleString('en-IN');

  /**
   * Put one row into the queue under test and hand back its title.
   *
   * Every one of these goes through the route an operator would use, not through a status write,
   * because a fixture that set the column directly would keep passing after the verb that is
   * supposed to produce that state stopped producing it.
   */
  async function seedInto(queueName, tag) {
    const admin = await authHeaders(ACTORS.admin);
    /* Staff Posted reads `posted_by_admin`, a column only the concierge route sets — so this one
       cannot start from an owner-created listing at all. `conciergeListing` above already speaks
       that route's shape (the listing body nests under `listing:`), so it is reused rather than
       re-described here; the first draft of this helper inlined its own POST, guessed a flat body,
       and earned a 422 naming `listing: must not be null`. */
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
    /* Featuring is a toggle on an approved listing, so the fixture has to clear moderation first —
       which is also the honest shape: nothing gets promoted to the front page out of the pending
       queue. The verb is `toggle-featured`, not `featured`; the latter 404s. */
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

      /* An independent read of the same facet, asking only for the count. `size=1` because
         `totalElements` is the whole answer — fetching rows here would invite comparing arrays,
         and on a catalogue three other specs are writing to that is a race, not an assertion. */
      const truth = await api('GET', `/admin/properties?${q.facet}&archived=false&page=0&size=1`, admin);
      expect(truth.status).toBe(200);
      const serverTotal = truth.body.totalElements;
      expect(serverTotal, `no listing is in the ${q.name} queue, so nothing below can fail`)
        .toBeGreaterThan(0);

      /* (1) The facet reaches the server. Armed before `openConsole`, not before the tab click:
         every queue hook runs on mount regardless of which tab is selected, so all five fetches
         have already gone out by the time the console has rendered. A wait armed around
         `openTab` finds nothing and times out — which is what the first run of this test did. */
      const queueReq = page.waitForRequest(
        (r) => r.method() === 'GET'
          && r.url().includes('/api/admin/properties?')
          && r.url().includes(q.param),
      );
      await login.asAdmin();
      await openConsole(page);
      const req = await queueReq;
      expect(new URL(req.url()).searchParams.get('archived'), 'the queue asked for archived rows too')
        .toBe('false');

      await openTab(page, q.name);

      /* (2) The count on screen is the server's count. Which number carries it depends on size:
         above `PAGE_LIMIT` the hint states the total, below it the rows themselves are the total,
         and above `PAGE_SIZE` the banner is the only place the true figure appears at all. */
      const reachable = Math.min(serverTotal, PAGE_SIZE);
      if (serverTotal > PAGE_SIZE) {
        await expect(page.getByTestId(q.banner)).toContainText(fmtNum(serverTotal));
      }
      if (reachable > PAGE_LIMIT) {
        await expect(page.getByText(`Showing ${PAGE_LIMIT} of ${reachable}`)).toBeVisible();
      } else {
        await expect(cards(page)).toHaveCount(reachable);
      }

      /* The positive anchor, last: the queue is not merely the right size, it contains the row that
         was put into it. An assertion about a count alone is satisfied by a coincidence. The
         placeholder is named per queue rather than matched loosely — every tab renders its own box
         and three of them share a placeholder, so a regex plus `.first()` would be asserting about
         whichever pane happened to be in the DOM. */
      await page.getByPlaceholder(q.search).fill(fixture.title);
      await expect(page.getByText(fixture.title, { exact: false }).first()).toBeVisible();
    });
  }

  /**
   * The search box searches the *queue*, not the page of it that happens to be loaded.
   *
   * This is the companion defect to the counts above and it was the one an operator would actually
   * ring about. Every box on this screen said "Search title, owner, locality…" and every one of
   * them filtered an array the browser already held — so the reachable catalogue was the newest
   * hundred rows, and a term that matched nothing in those hundred produced the sentence "No
   * listings match your filters". Not "not on this page". The console stated, in as many words,
   * that a listing sitting in its own verification queue did not exist. The truncation banners
   * added alongside make it worse if left unfixed: they tell the operator to narrow with the search
   * box to reach the rest, which was advice the box could not take.
   *
   * The subject row is chosen at runtime as the *oldest* row in the queue — the last page of a
   * newest-first sort — and the test then asserts it is absent from the hundred rows the console
   * fetches. That assertion is the vacuity guard, and it is the whole test: without it this reads
   * as "search finds a row", which the browser-side filter also did. With it, every search below is
   * for a row the old build provably did not have in memory. It is skipped rather than faked when
   * the queue is smaller than a page, because on a small database there is no such row to find and
   * a test that invented one would be testing its own fixture.
   *
   * Two terms here, because these are the two the browser could otherwise have answered. The old
   * filter was `(title + owner + locality + id).includes(q)` over the loaded array, so owner *name*
   * — what the placeholder always promised — and the *id tail* — how a listing travels between two
   * people in chat, matched as a substring precisely so a fragment pasted out of a message works —
   * both worked already for anything on the first page. Only distance makes them a test.
   *
   * Owner *mobile* is deliberately not here. It was reachable by neither half of the old build, so
   * it needs no distance to be meaningful, and keeping it in a test that skips below a hundred rows
   * would have left the one axis a desk actually uses unproven on every clean database. It has its
   * own test below.
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

    /* Each term is checked for selectivity against the server before it is typed, so a term that
       happens to match more rows than one page of the list renders can never fail this as though
       the search were broken. */
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
   * The one key a desk actually has in its hand.
   *
   * The caller is on the phone. Their number is the only thing they can read out without spelling
   * it, and until this wave it was the one thing the console could not be asked. The old build had
   * no path to it at all: the server's `q` was title-or-locality, and the browser's was
   * `(title + owner + locality + id).includes(q)` over the loaded array. A mobile number is in
   * neither list, so this needed no page-cap argument to be a real gap, and it needs none to be a
   * real test \u2014 which is why it is here and not in the sibling above, whose premise cannot exist on
   * a queue of fifteen rows and which therefore skips on every clean database.
   *
   * The vacuity guard is the other half. A number that happened to appear inside the row's own
   * title or id would have been found by the old browser filter incidentally, and this would then
   * pass on the build it is meant to fail on. So the term is asserted absent from exactly the
   * string that filter concatenated, field for field.
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
   * And the same widening must not have happened on the public search.
   *
   * `q` used to be one shared predicate over title and locality, which is why widening it was a
   * one-line change and why that one line would have been a leak: `/properties?q=98234` on an
   * endpoint that needs no login would have answered "which landlords' numbers begin 98234, and
   * exactly what does each of them own" — an owner directory, assembled from the field the listing
   * page masks on purpose. Hence two named builders rather than one with a flag.
   *
   * The negative half is worthless alone: a public search returns nothing for an unpublished row,
   * for a typo, or for an endpoint that has stopped working, and all three read as privacy. So the
   * subject is taken from the *public* list — a row any visitor can already see — and each absence
   * is paired with the same term put to the admin search, which must find it. The pair is the
   * assertion: this term is a real key that identifies this row, and it works from a desk and does
   * not work from the street.
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

    /* The anchor: this row is reachable through the public search by the words on its own card, so
       everything below is about the *term*, not about the row being invisible or the endpoint
       being broken. */
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
   * The cost of moving the search to the server, and the row that pays it.
   *
   * A browser-side filter narrowed on the keystroke, so what the box said and what the list showed
   * could never disagree. A server-side one cannot: there is a fetch between them, and for its
   * duration the box reads the new term while the rows below are still the answer to the old one.
   * Every one of those rows carries Approve, Reject, Archive and — on the follow-up tab — Remind,
   * which writes a chaser addressed to a named owner and opens WhatsApp on it.
   *
   * That is not hypothetical. `listing-freshness.spec.js` caught it the first time this shipped:
   * the desk searched one owner's listing, pressed Remind on the only row it could see, and the
   * toast came back "Chaser written for Tanvi Jain" — a different owner, a real outbound message,
   * produced by a search box. The fix is that a queue whose rows answer a previous term is inert
   * until they do not, so a click waits for the row it was aimed at instead of landing on whatever
   * was underneath.
   *
   * The test therefore does the one thing a careful test usually avoids: it does not wait. Typing
   * and clicking with no settle in between is the whole subject. Three things make it non-vacuous —
   * the row on top before the term is typed is asserted to be a *different* listing, so a click
   * that ignores the term has a wrong answer available to give; the queue is asserted to be
   * mid-update at the moment of the click, so the click really is made inside the window; and the
   * term is the target's id, which matches exactly one row, so "the top row" and "the target" can
   * only coincide on purpose.
   *
   * View, not Approve: the assertion needs an action that names the row it acted on, and this one
   * is observable without changing anything. The hazard is the same for every button beside it.
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

    /* The mechanism itself, asserted before the click so that the click below is provably made
       into a queue that is mid-update rather than one that already settled. Without this the rest
       could pass simply by being slow enough to miss the window it exists to test. */
    await expect(
      page.getByTestId('queue-updating'),
      'the queue never marked itself as answering a stale term, so the click below is not being made during the window this test is about',
    ).toBeVisible();

    /* Deliberately no wait: this is the click a real operator makes, into rows that still answer
       the previous term. Scoped to the card, and exact: `getByTitle` matches substrings, so a bare
       `getByTitle('View')` also selects the shell's `title="View live site"` button, which precedes
       the queue in the DOM. `.first()` then clicks it and leaves the console for the public home
       page — a failure that reads exactly like the defect this test hunts. */
    await cards(page).first().getByTitle('View', { exact: true }).click();

    /* Then let it settle. The search is selective to one row, so the list can only be showing the
       target — which is also the anchor that stops the absence check below being vacuous: if the
       search were broken this assertion fails first, rather than "no wrong modal" passing on an
       empty screen. */
    await expect(
      cards(page).first(),
      'the search never resolved to the row it selects, so nothing below is being proven',
    ).toContainText(target.title);

    /* Whether the mis-timed click was discarded or honoured late is not the contract and both are
       safe. What is the contract is that it never acted on the row that happened to be underneath
       it, so a modal open at this point must be the target's. */
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

  /* `Active` and `Total` both select All Listings. The existing all-tile sweep reaches Active
     after Total, so it cannot tell a working click from a button wired to nothing; start on
     Pipeline to make the transition observable. This retires the mock-only counterpart. */
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

    /* The header includes rejected records, but the board intentionally does not. Derive the
       board's eligible count from the exact response the page rendered instead of accepting a
       positive subset: that is what makes an unrecognised pipeline stage falling through the
       mapper observable. */
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
