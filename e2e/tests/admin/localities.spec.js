import { test, expect } from '../../fixtures/base.js';
import { appReady } from '../../helpers/app.js';

/* /admin/localities — the two claims about this screen that only mock mode can hold.
 *
 * `admin/live-localities-console.spec.js` now proves the console against the live API: the queue
 * carrying the owner's own words, filing a listing under an area (re-read from outside the browser
 * that filed it), the absence of any "reviewed but still unfiled" action, the assign dropdown's
 * options compared against `GET /localities`, the Directory tab compared to the server's own answer
 * in the server's own order, the KPI shortcuts, and the buyer guard. Six of this file's eight tests
 * moved there and were deleted here rather than left to run twice.
 *
 * What is left is the two states the live API cannot be asked to produce:
 *
 * 1. **Live and unfindable.** Approving a listing with no locality is refused, and un-filing an
 *    approved one answers 422 — so the state is unreachable through the API, and the tile counts a
 *    population that can only predate the approval guard. It still has to render, because rows in
 *    that state exist in databases older than the guard, and a tile that silently averages them
 *    into a backlog total is how they stay hidden. Reaching it needs a store you can write to.
 *
 * 2. **The empty queue.** Live runs against a shared database that other specs post into, so
 *    "nothing is waiting" is not a state this suite can guarantee — and asserting it would make the
 *    file fail for a reason with nothing to do with the screen. Here the seeded store has every
 *    listing filed, so the empty state is simply the default.
 *
 * ## Seeding
 *
 * Stripping the slug has to happen **after** a real navigation, not in an init script: mockApi
 * migrates and merges `puneNestDB_v5` at module load, so a store written before boot is overwritten
 * or leaves the app with no settings and a blank page (see e2e/README.md).
 *
 * `Table` renders BOTH a desktop <table> and a stacked `.pn-card` list for phones, hiding one with
 * CSS. Assertions therefore have to name a surface — an unscoped getByText matches twice and trips
 * strict mode, or resolves to the hidden copy and fails against correct markup. These specs run on
 * desktop, so they scope to the table.
 */

const table = (page) => page.getByRole('table');
const row = (page, name) => table(page).locator('tr').filter({ hasText: name });

/* The KPI tiles and the empty state are both `.pn-card`, and the empty state's copy repeats the
   tile's label on purpose — "Nothing awaiting a locality" is the sentence a curator wants to read.
   So a filtered `.pn-card` matches both the moment the queue empties, which is exactly when these
   assertions run. `.first()` is the tile: it is rendered above the table. */
const kpi = (page, label) => page.locator('.pn-card', { hasText: label }).first();

/**
 * Strip the locality slug off one seeded listing, leaving the owner's free text behind — exactly
 * the state the server's resolver produces when it declines to coin a slug for text it does not
 * recognise.
 */
async function unfile(page, { title, locality, status }) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await appReady(page);
  await page.evaluate(({ title: t, locality: l, status: s }) => {
    const KEY = 'puneNestDB_v5';
    const db = JSON.parse(localStorage.getItem(KEY));
    const listing = db.listings[0];
    listing.title = t;
    listing.locality = l;
    listing.status = s;
    delete listing.localitySlug;
    localStorage.setItem(KEY, JSON.stringify(db));
  }, { title, locality, status });
}

test.describe('Admin — Localities (states the live API will not produce)', () => {
  test('an approved listing nobody can find is called out separately from the backlog', async ({ page, login, consoleErrors }) => {
    await login.asAdmin();
    await unfile(page, { title: 'Zztest Live Flat', locality: 'Undhera Wasti', status: 'approved' });
    await page.goto('/admin/localities');

    /* An approved listing with no locality is live *and* absent from every locality surface — it is
       failing buyers now, where a pending one is only about to. The tile exists so that number is
       not averaged away into a backlog total that is never zero. */
    await expect(kpi(page, 'Live and unfindable')).toContainText('1');
    await expect(row(page, 'Zztest Live Flat')).toContainText('Live · unfindable');
    expect(consoleErrors).toEqual([]);
  });

  test('an empty queue says every listing is findable, rather than rendering a blank table', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/localities');

    // Nothing is unfiled in the seeded store, so this is the default state.
    await expect(table(page).getByText(/Nothing awaiting a locality/i)).toBeVisible();
  });
});
