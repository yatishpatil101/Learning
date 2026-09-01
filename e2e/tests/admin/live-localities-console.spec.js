/**
 * LIVE: `/admin/localities` — the curator's screen, not the endpoint behind it.
 *
 * `platform/live-locality-queue.spec.js` already proves the queue is server-side, that filing a
 * listing clears it, that a retired area is refused, and that approval is blocked while a listing
 * has no locality. All of that is asserted over HTTP. None of it says the console renders any of
 * it, and the console is the whole point of the fix: the server's refusal to approve an unfiled
 * listing is only fair if a human has a working screen to go and file it on. This file covers that
 * screen against the real API.
 *
 * The mock twin (`admin/localities.spec.js`) could not. It reached into `puneNestDB_v5`, deleted
 * `localitySlug` off the first seeded listing, and asserted the page re-read the object the test
 * had just written. That proves the component renders a shape; it cannot prove the shape is one the
 * server produces. Here the subject is created through the real owner route with free text no
 * seeded locality can match, so the null column is the resolver's own decision — which is the
 * regression the queue is downstream of, and the one a forced fixture would sail straight past.
 *
 *   cd e2e; npx playwright test tests/admin/live-localities-console.spec.js --config=playwright.live.config.js
 */
import { expect, test, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

/** Free text no seeded locality can match, so the resolver is forced to leave the column null. */
const UNPLACEABLE = 'Zztest Wasti Phata';

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
};

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/**
 * A listing the catalogue cannot file, under an owner nobody else in the suite shares.
 *
 * `expect` on the null slug is not ceremony: it is the premise of every assertion below. If the
 * resolver ever starts coining a slug from free text again, the queue empties and every test here
 * would pass vacuously against an empty screen.
 */
async function unfiledListing(title) {
  const headers = await authHeaders(uniqueMobile());
  const created = await api('POST', '/me/listings', headers, {
    ...BASE_LISTING, title, locality: UNPLACEABLE,
  });
  expect(created.status).toBe(201);
  expect(created.body.localitySlug ?? null).toBeNull();
  return created.body.id;
}

/** The queue as the server sees it, for re-reading a change from outside the browser that made it. */
const queueRows = async () => (await api('GET', '/admin/locality-queue', await authHeaders(ACTORS.admin))).body;

/**
 * Take a listing this spec left unfiled back out of the shared queue.
 *
 * The live database is not reset between runs and the queue is capped at 200 rows, so a spec that
 * ends with a listing still unfiled has to clear it or it accumulates until real backlog is pushed
 * off the end of the page. Rejection rather than an assign: filing junk under Baner to tidy up
 * would put fake rows on a real locality's landing page, and rejecting is what a curator would
 * actually do with an address that does not exist.
 */
async function discard(id) {
  await api('PATCH', `/properties/${id}/status`, await authHeaders(ACTORS.admin),
    { status: 'rejected', reason: 'Zztest cleanup — synthetic queue fixture' });
}

/* `Table.jsx` renders BOTH a desktop <table> and a stacked `.pn-card` list for phones, hiding one
   with CSS. An unscoped `getByText` therefore matches twice and trips strict mode, or resolves to
   the hidden copy and fails against correct markup. These specs run on desktop, so they scope to
   the table. */
const table = (page) => page.getByRole('table');
const row = (page, name) => table(page).locator('tr').filter({ hasText: name });

/* The KPI tiles and the empty state are both `.pn-card`, and the empty state's copy repeats the
   tile's label on purpose — "Nothing awaiting a locality" is the sentence a curator wants to read.
   So a filtered `.pn-card` matches both the moment the queue empties, which is exactly when these
   assertions run. `.first()` is the tile: it is rendered above the table. */
const kpi = (page, label) => page.locator('.pn-card', { hasText: label }).first();

/**
 * Open the console and wait for the queue response, rather than for the page to settle.
 *
 * `AdminLocalities` seeds `queue` with `{ total: 0, listings: [] }` and renders the empty state
 * while `reload()` is in flight, so a screen that never got an answer is pixel-identical to one
 * whose queue is genuinely empty. Waiting on the response is what makes the difference between the
 * two visible to a test.
 */
async function openConsole(page, tab = 'pending') {
  /* Both reads are waited on, not just the queue. `reload()` fires them together and renders from
     whichever lands first, so a Directory assertion racing only the queue response can run against
     an empty `directory` array and read as a missing area.

     The `/api/` prefix on the second matcher is load-bearing. Without it the pattern also matches
     the page's own document request — this screen lives at `/admin/localities` — so the wait
     resolved on the navigation itself and the test raced the very fetch it meant to wait for. It
     failed as "Baner is not in the directory", which is a sentence about the catalogue rather than
     about the timing, and would have been a tempting thing to fix by weakening the assertion. */
  const [queueRes, dirRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/locality-queue') && r.request().method() === 'GET'),
    page.waitForResponse((r) => /\/api\/localities(\?|$)/.test(r.url()) && r.request().method() === 'GET'),
    page.goto(`/admin/localities${tab === 'directory' ? '?tab=directory' : ''}`),
  ]);
  expect(queueRes.status()).toBe(200);
  expect(dirRes.status()).toBe(200);
}

test.describe('LIVE: the localities console', () => {
  test('a listing the resolver could not place is waiting here, with the words its owner typed', async ({ page, login, consoleErrors }) => {
    const id = await unfiledListing('Zztest console subject');
    await login.asAdmin();
    await openConsole(page);

    await expect(page.getByRole('heading', { name: 'Localities' })).toBeVisible();
    // The free text is what makes the row decidable — a title and a pin is guessing.
    await expect(row(page, 'Zztest console subject')).toContainText(UNPLACEABLE);
    /* Not `toContainText('1')`. The live queue is shared and its depth is whatever real backlog
       happens to be sitting in it, so the assertion has to be "at least the one this test put
       there" rather than a magnitude. A count pinned to 1 would fail the moment a sibling spec
       leaves a row behind, and the failure would read as a bug in this screen. */
    await expect(kpi(page, 'Awaiting a locality')).toContainText(/\d/);
    expect(consoleErrors).toEqual([]);

    await discard(id);
  });

  /* The mock twin had a test here for the "Live and unfindable" tile — an *approved* listing with
     no locality, which is failing buyers now where a pending one is only about to. It is not
     carried over, and the reason is a finding rather than an omission: that state is unreachable
     through the API. Approving an unfiled listing is refused (`live-locality-queue` asserts it),
     and un-filing a filed one is refused too — `PATCH /admin/locality-queue/{id}` answers 422 to a
     null slug. So the tile counts a population that can only predate the approval guard, and the
     only ways to test it would be to write a null straight into the column or to seed one, both of
     which assert that the component renders a shape rather than that the server produces it. The
     mock could do it precisely because nothing there refused. */

  test('filing a listing under an area clears it from the queue', async ({ page, login }) => {
    const id = await unfiledListing('Zztest assign from console');
    await login.asAdmin();
    await openConsole(page);

    const subject = row(page, 'Zztest assign from console');
    await subject.getByRole('combobox').selectOption('baner');

    /* Waiting on the PATCH rather than on the toast. The toast is rendered from the client's own
       optimistic knowledge of which area was picked, so it appears whether or not the write landed;
       the response is the only thing that proves a server saw this. */
    const [assigned] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/admin/locality-queue/') && r.request().method() === 'PATCH'),
      subject.getByRole('button', { name: 'Assign' }).click(),
    ]);
    expect(assigned.status()).toBe(200);

    await expect(page.getByText(/filed under Baner/i).first()).toBeVisible();
    // Gone from the queue is the assertion that matters: a toast with no write behind it would pass
    // a weaker test, and so would a row removed only from client state.
    await expect(subject).toHaveCount(0);

    /* Re-read from outside the browser that made the change, which is the half a mock cannot do.
       The queue is the right witness rather than the listing's own detail route: leaving the queue
       is what the operator was trying to achieve, and it is a fact the server computes from the
       column rather than one this client could report about itself. */
    expect((await queueRows()).listings.map((r) => r.id)).not.toContain(id);

    await discard(id);
  });

  test('there is no way to mark a row reviewed while leaving it unfiled', async ({ page, login }) => {
    const id = await unfiledListing('Zztest no dismiss');
    await login.asAdmin();
    await openConsole(page);

    /* The deleted Dismiss button is the reason this assertion exists. "Reviewed, still has no
       locality" is the exact state the queue was opened to end, and an action producing it would
       reduce the server's approval refusal back to the warning it replaced — the listing would go
       live invisible with a human's signature on it. */
    const subject = row(page, 'Zztest no dismiss');
    await expect(subject.getByRole('button', { name: /dismiss/i })).toHaveCount(0);
    await expect(subject.getByRole('button', { name: /verify/i })).toHaveCount(0);

    await discard(id);
  });

  test('the areas offered are the ones the server will accept', async ({ page, login }) => {
    const id = await unfiledListing('Zztest options match server');
    await login.asAdmin();
    await openConsole(page);

    /* The directory used to render the bundled `data/localities.js`, a build artefact — an area
       added through the console did not appear here until someone shipped a release, and a retired
       one went on being offered. Both halves are silent failures, so the option list is compared
       against `GET /localities` itself rather than against a literal: an operator can only be
       offered a choice the server will honour if these two sets are the same set. */
    const live = await api('GET', '/localities', {});
    const expected = live.body.filter((l) => l.active !== false).map((l) => l.slug).sort();
    expect(expected.length).toBeGreaterThan(0);

    const offered = await row(page, 'Zztest options match server')
      .getByRole('combobox')
      .locator('option')
      .evaluateAll((nodes) => nodes.map((n) => n.value).filter(Boolean));
    expect(offered.slice().sort()).toEqual(expected);

    await discard(id);
  });

  test('the Directory tab lists the areas listings can be filed under', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page, 'directory');

    /* The directory used to render the bundled `data/localities.js`, a build artefact, so the
       assertion that matters is that these rows came from `GET /localities` — not that any
       particular area is present. The first page is compared against the first page of the
       server's own answer, in the server's own order: a client that re-sorted, filtered or fell
       back to the bundle would disagree here even while looking perfectly plausible.

       Named areas are deliberately not hardcoded. `Table` paginates at ten and the catalogue runs
       to dozens, so asserting on "Baner" tests which page the seed happens to put it on. */
    const catalogue = (await api('GET', '/localities', {})).body;
    expect(catalogue.length).toBeGreaterThan(0);

    const shown = await table(page).locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.cells[0]?.textContent?.trim()));
    expect(shown.length).toBeGreaterThan(0);
    // The first cell stacks the display name over the slug, so this compares both at once — and the
    // slug is the half that matters, since it is what a filing writes and what search keys off.
    expect(shown).toEqual(catalogue.slice(0, shown.length).map((l) => `${l.name}${l.slug}`));

    // And the status column is the server's `active` bit rather than a decoration.
    const first = catalogue[0];
    await expect(row(page, first.name).first()).toContainText(first.active === false ? 'Retired' : 'Live');
  });

  test('KPI tiles double as tab shortcuts', async ({ page, login }) => {
    await login.asAdmin();
    await openConsole(page);

    await kpi(page, 'Localities').click();
    await expect(page).toHaveURL(/tab=directory/);
  });

  test('a signed-in buyer cannot reach the console', async ({ page, login }) => {
    /* The API-level twin of this lives in `live-locality-queue` (`403` on the route). This is the
       other half: a consumer who types the URL is bounced rather than shown a shell that fails its
       fetches, which is what a guard that checked only the route and not the screen would give. */
    await login.asBuyer();
    await page.goto('/admin/localities');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin/localities'));
    expect(new URL(page.url()).pathname).not.toBe('/admin/localities');
  });
});
