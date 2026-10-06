/** Asserts the paging request: a client-side slice of loaded rows renders the same range without fetching. */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** The console's own page size (`DIR_PAGE_SIZE` in `AdminSocieties.jsx`), and `GET /societies`'s default. */
const PAGE_SIZE = 20;

/** `fmtNum` groups thousands, so the rendered total is `1,234` once the catalogue passes a thousand. */
const grouped = (n) => n.toLocaleString('en-IN');

/** One page of the catalogue read directly and anonymously: `GET /societies` is public, which the guard tests at the bottom assert. */
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
/** The Directory tab's count pill, so `20` cannot be satisfied by a `20` elsewhere on the page. */
const dirCount = (page) => page.getByTestId('tab-count-directory');
const range = (page) => page.getByTestId('queue-range').first();

// ─── The desk itself ───

test('the desk counts the whole catalogue, not the page it is showing', async ({ page, login, consoleErrors }) => {
  const { totalElements } = await catalogue();
  /* The test is only meaningful on a catalogue bigger than one page — otherwise the tile and the
     row count agree and the assertion below cannot distinguish them. Say so rather than pass. */
  expect(totalElements, 'the seeded catalogue must exceed one page for this file to mean anything')
    .toBeGreaterThan(PAGE_SIZE);

  await login.asAdmin();
  await openDirectory(page);

  /* Read `dir.total` from the envelope: `dir.items.length` renders 20 for any catalogue size and raises no error. */
  await expect(dirCount(page)).toHaveText(grouped(totalElements));
  await expect(dirCount(page)).not.toHaveText(String(PAGE_SIZE));
  await expect(rows(page)).toHaveCount(PAGE_SIZE);

  // All five tabs and their counts. Values belong to the queues, and to the specs that own those queues.
  for (const [key, label] of [['claims', 'Claims'], ['residents', 'Residents'], ['candidates', 'Candidates'], ['moderation', 'Moderation'], ['directory', 'Directory']]) {
    await expect(page.getByRole('tab', { name: new RegExp(`^${label}`) })).toBeVisible();
    await expect(page.getByTestId(`tab-count-${key}`)).toHaveText(/^\d[\d,]*$/);
  }

  /* The disclosure banner renders only when a queue failed to load. Its absence is what makes the
     counts above worth reading. */
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

  await expect(range(page)).toHaveText(`1–${PAGE_SIZE} of ${grouped(totalElements)}`);
  const firstName = await rows(page).first().locator('td').first().innerText();

  /* Assert the request: `Table`'s own pager advances the range without asking the server. */
  const request = page.waitForResponse(
    (r) => /\/api\/societies\?/.test(r.url()) && new URL(r.url()).searchParams.get('page') === '1',
  );
  await page.getByRole('button', { name: 'Next page' }).first().click();
  await request;

  await expect(range(page)).toHaveText(`${PAGE_SIZE + 1}–${PAGE_SIZE * 2} of ${grouped(totalElements)}`);
  // The rows are the ones the server just sent, in its order, not a re-sorted local slice.
  await expect(rows(page).first().locator('td').first()).toContainText(second.content[0].name);
  await expect(rows(page).first().locator('td').first()).not.toHaveText(firstName);
});

test('the search finds a society the first page does not contain', async ({ page, login }) => {
  const firstPage = await catalogue();
  const firstPageNames = new Set(firstPage.content.map((s) => s.name));

  /* The adversarial row: a client-side filter over the 20 loaded rows finds nothing, so the target must be provably off the first page
       (taken from the far end of `name ASC` so catalogue growth cannot move it onto it). */
  const last = await catalogue({ page: String(Math.max(0, firstPage.totalPages - 1)) });
  const target = last.content.reverse().find((s) => !firstPageNames.has(s.name));
  expect(target, 'no society exists off the first page — the catalogue is too small to test search').toBeTruthy();

  await login.asAdmin();
  await openDirectory(page);
  await expect(rows(page).filter({ hasText: target.name }), 'the target must start off screen').toHaveCount(0);

  const request = page.waitForResponse(
    (r) => /\/api\/societies\?/.test(r.url()) && new URL(r.url()).searchParams.get('q') === target.name,
  );
  await page.getByLabel('Search societies').fill(target.name);
  await request;

  await expect(rows(page).filter({ hasText: target.name })).toHaveCount(1);
  /* With a search applied the count is the filtered set's size, the number the operator is looking at. */
  await expect(dirCount(page)).not.toHaveText(grouped(firstPage.totalElements));
});

test('the admin society route refuses a stranger and a buyer, though the catalogue is public', async () => {
  // The console reads the public `GET /societies`: every column it draws is already on the anonymous payload.
  const listing = await fetch(`${API}/societies?page=0&size=1`);
  expect(listing.status).toBe(200);

  // `adminNote` is moderator prose about a named building, so the admin view of one society is guarded by `societies:read`.
  const slug = (await catalogue({ size: '1' })).content[0].slug;
  const anonymous = await fetch(`${API}/admin/societies/${slug}`);
  expect(anonymous.status).toBe(401);

  // A buyer holds a valid token: 401 says "who are you", 403 says "not you".
  const asBuyer = await fetch(`${API}/admin/societies/${slug}`, { headers: await authHeaders(ACTORS.buyer) });
  expect(asBuyer.status).toBe(403);
});
