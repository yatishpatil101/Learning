/**
 * The **Directory tab** of the society desk — the catalogue an operator browses — against the live API.
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore`); needs a backend under the
 * `dev,e2e` profiles and a seeded database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/admin/live-societies-directory.spec.js --config=playwright.config.js
 *
 * ## Why this file exists, and what it replaced
 *
 * `admin/societies.spec.js` covered this screen in mock mode and has been **deleted**. Four of its
 * six tests already had live homes and two did not, so it was carried by a minority of itself:
 *
 * | its test | where the claim lives now |
 * | --- | --- |
 * | KPI tiles, tab bar, empty claims queue | the tiles and tabs are below; the "empty queue" half was false against a seeded database, and the real claims queue is `live-societies.spec.js` |
 * | Directory paging and search | below — this is the part nothing else covered |
 * | the edit overlay saves with a toast | `live-society-admin.spec.js` |
 * | the Moderation tab is empty | dropped: every assertion was an absence with no anchor, and `societies-queues.spec.js` covers moderation with rows in it |
 * | the two route guards | below, and against the API as well as the router |
 *
 * ## Why paging is worth a live spec rather than a mock one
 *
 * The catalogue is three hundred and fifty rows and the page is twenty, so "does Next fetch" is the
 * whole behaviour. A mock spec cannot tell the two implementations apart: `Table` has an internal
 * pager that slices rows already in the browser, and against a fixture that holds the whole
 * catalogue, a client-side slice and a server round trip render the same thing. The difference only
 * becomes visible when the browser does not have the rest — which is the live case, and the case an
 * operator is in.
 *
 * So the paging test below asserts the **request**, not just the rendered range, and the search test
 * looks for a society the first page provably does not contain. Client-side filtering over the
 * loaded twenty would find nothing, which is the failure this is shaped to catch.
 *
 * ## Nothing here seeds storage
 *
 * No `addInitScript`, no `localStorage.setItem`. Every number below is read from Postgres twice —
 * once by the browser and once by the test, over its own token — and compared.
 *
 * Fixtures: `docs/system/fixture-registry.md` → the `society` rows.
 */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** The console's own page size (`DIR_PAGE_SIZE` in `AdminSocieties.jsx`), and `GET /societies`'s default. */
const PAGE_SIZE = 20;

/** `fmtNum` groups thousands, so the rendered total is `1,234` once the catalogue passes a thousand. */
const grouped = (n) => n.toLocaleString('en-IN');

/**
 * One page of the catalogue, read directly rather than through the app.
 *
 * Anonymous on purpose: `GET /societies` is the public route, which is the same fact the guard tests
 * at the bottom turn into an assertion. If that ever changes these calls start failing, which is the
 * correct way to find out.
 */
async function catalogue(params = {}) {
  const qs = new URLSearchParams({ page: '0', size: String(PAGE_SIZE), ...params });
  const res = await fetch(`${API}/societies?${qs}`);
  expect(res.status, `GET /societies?${qs}`).toBe(200);
  return res.json();
}

/** Open the Directory tab and wait for its table. The tab is a URL parameter (`useTabParam`). */
async function openDirectory(page) {
  await page.goto('/admin/societies?tab=directory');
  await expect(page.getByRole('heading', { name: 'Societies', exact: true })).toBeVisible({ timeout: 20000 });
  /* Rows are in the DOM twice — `Table` renders an `sm:hidden` stacked card per row before the
     `hidden sm:block` table — so every locator here is scoped to the table or it counts double. */
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20000 });
}

const rows = (page) => page.locator('table tbody tr');
/** The number inside a KPI tile, so `20` cannot be satisfied by a `20` elsewhere in the card. */
const kpi = (page, label) => page.locator('.pn-card').filter({ hasText: label }).first().locator('.text-2xl');

// ─── The desk itself ───

test('the desk counts the whole catalogue, not the page it is showing', async ({ page, login, consoleErrors }) => {
  const { totalElements } = await catalogue();
  /* The test is only meaningful on a catalogue bigger than one page — otherwise the tile and the
     row count agree and the assertion below cannot distinguish them. Say so rather than pass. */
  expect(totalElements, 'the seeded catalogue must exceed one page for this file to mean anything')
    .toBeGreaterThan(PAGE_SIZE);

  await login.asAdmin();
  await openDirectory(page);

  /* The tile reads `dir.total` from the page envelope. Reading `dir.items.length` instead — the
     obvious refactor, and one that raises no error anywhere — renders `20` on every catalogue of any
     size, and an operator has no way to tell. Pinning it to the server's own count is the only
     assertion that separates them, and it needs a server to have a count. */
  await expect(kpi(page, 'Societies')).toHaveText(grouped(totalElements));
  await expect(kpi(page, 'Societies')).not.toHaveText(String(PAGE_SIZE));
  await expect(rows(page)).toHaveCount(PAGE_SIZE);

  // All five tabs, by their labels in `AdminSocieties.jsx`.
  for (const label of ['Claims', 'Resident Verifications', 'Candidates', 'Directory', 'Moderation']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  // The other four KPI tiles. Values belong to the queues, and to the specs that own those queues.
  for (const label of ['Pending claims', 'Pending residents', 'Candidates', 'Open reports']) {
    await expect(page.locator('.pn-card').filter({ hasText: label }).first()).toBeVisible();
  }

  /* The disclosure banner renders only when a queue failed to load. Its absence is what makes the
     counts above worth reading — every one of them is disclosed as wrong in the same sentence. */
  await expect(page.getByText(/could not be loaded/i)).toHaveCount(0);
  expect(consoleErrors).toHaveLength(0);
});

// ─── Paging ───

test('Next fetches the next page from the server instead of slicing one already in the browser', async ({ page, login }) => {
  const { totalElements } = await catalogue();
  const second = await catalogue({ page: '1' });
  expect(second.content.length, 'a second page must exist').toBeGreaterThan(0);

  await login.asAdmin();
  await openDirectory(page);

  await expect(page.getByText(`Showing 1–${PAGE_SIZE} of ${grouped(totalElements)} directory`)).toBeVisible();
  const firstName = await rows(page).first().locator('td').first().innerText();

  /* The assertion is the request, not the rendering. `Table`'s own pager would advance the range
     and change the first row too, without asking the server for anything — and against a fixture
     holding the whole catalogue it would look identical. Only the outbound `page=1` tells them
     apart, and only a server that has rows nineteen through three hundred can. */
  const request = page.waitForResponse(
    (r) => /\/api\/societies\?/.test(r.url()) && new URL(r.url()).searchParams.get('page') === '1',
  );
  await page.getByRole('button', { name: 'Next' }).click();
  await request;

  await expect(page.getByText(`Showing ${PAGE_SIZE + 1}–${PAGE_SIZE * 2} of ${grouped(totalElements)} directory`)).toBeVisible();
  // The rows are the ones the server just sent, in its order, not a re-sorted local slice.
  await expect(rows(page).first().locator('td').first()).toContainText(second.content[0].name);
  await expect(rows(page).first().locator('td').first()).not.toHaveText(firstName);
});

test('the search finds a society the first page does not contain', async ({ page, login }) => {
  const firstPage = await catalogue();
  const firstPageNames = new Set(firstPage.content.map((s) => s.name));

  /* The adversarial row. A filter applied to the twenty rows in the browser would find nothing here,
     and "no societies match that search" is a perfectly calm way to render that failure — which is
     why the target has to be a society that is provably off the first page rather than any society
     at all. Chosen from the far end of `name ASC` so the choice cannot quietly become a first-page
     row as the catalogue grows. */
  const last = await catalogue({ page: String(Math.max(0, firstPage.totalPages - 1)) });
  const target = last.content.reverse().find((s) => !firstPageNames.has(s.name));
  expect(target, 'no society exists off the first page — the catalogue is too small to test search').toBeTruthy();

  await login.asAdmin();
  await openDirectory(page);
  await expect(rows(page).filter({ hasText: target.name }), 'the target must start off screen').toHaveCount(0);

  const request = page.waitForResponse(
    (r) => /\/api\/societies\?/.test(r.url()) && new URL(r.url()).searchParams.get('q') === target.name,
  );
  await page.getByRole('searchbox', { name: 'Search societies' }).fill(target.name);
  await request;

  await expect(rows(page).filter({ hasText: target.name })).toHaveCount(1);
  /* The tile follows the filter: with a search applied it is the size of the filtered set, which is
     the number the operator is actually looking at. A tile frozen at the catalogue total would be
     the same shape of lie as one frozen at twenty. */
  await expect(kpi(page, 'Societies')).not.toHaveText(grouped(firstPage.totalElements));
});

// ─── Who may open it ───

test('an unauthenticated visitor is turned away from the desk, though the catalogue itself is public', async ({ page }) => {
  await page.goto('/admin/societies?tab=directory');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Societies', exact: true })).toHaveCount(0);

  /* The listing behind this screen is deliberately the public route — the console reads
     `GET /societies` rather than an admin listing of its own, because every column it draws is
     already on the anonymous payload. So there is nothing to refuse here, and asserting a 401 on it
     would be asserting the opposite of the design. Recorded as an assertion rather than a comment,
     because a route that quietly stopped being public would break the consumer catalogue and this is
     the file that says out loud that it is not supposed to. */
  const listing = await fetch(`${API}/societies?page=0&size=1`);
  expect(listing.status).toBe(200);

  /* What is guarded is the *admin* view of one society, and only because of `adminNote` —
     moderator prose about a named building, often about the people in it. `SocietyAdminController`
     puts it behind `societies:read` for exactly that reason. `live-society-admin.spec.js` proves the
     note stays off the public payload; this proves the route that carries it refuses a stranger. */
  const slug = (await catalogue({ size: '1' })).content[0].slug;
  const anonymous = await fetch(`${API}/admin/societies/${slug}`);
  expect(anonymous.status).toBe(401);
});

test('a buyer is turned away by the router and by the admin society route', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/societies?tab=directory');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Societies', exact: true })).toHaveCount(0);

  /* A signed-in consumer holds a perfectly good token, so this is a different refusal from the one
     above and a different bug if it breaks: 401 says "who are you", 403 says "not you". A buyer who
     can read this route can read the desk's private notes on every building in Pune. */
  const slug = (await catalogue({ size: '1' })).content[0].slug;
  const asBuyer = await fetch(`${API}/admin/societies/${slug}`, { headers: await authHeaders(ACTORS.buyer) });
  expect(asBuyer.status).toBe(403);
});
