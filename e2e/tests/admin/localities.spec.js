import { test, expect } from '../../fixtures/base.js';
import { appReady } from '../../helpers/app.js';

/* /admin/localities — the curation queue, and the directory it files into.
 *
 * ## What this file used to assert, and why none of it survived
 *
 * It seeded `pnCommunityLocalities` — a localStorage array of areas the browser had minted from
 * unrecognised free text — and checked that Verify promoted one and Dismiss removed one. Both
 * actions are gone with the tier (register item 24), because both operated on the wrong object: the
 * *listing* whose area failed to resolve was never in that queue, so promoting or dismissing a
 * locality left it exactly as unfindable as before.
 *
 * The queue is now listings with no `localitySlug`, read from the seam, and the only action is to
 * file one under an area that already exists.
 *
 * ## Seeding
 *
 * Every seeded listing in `db.json` already has a locality, so the queue is empty by default —
 * which is itself worth asserting, and is the empty-state test below. The other tests strip the
 * slug off the first row.
 *
 * That has to happen **after** a real navigation, not in an init script: mockApi migrates and
 * merges `puneNestDB_v5` at module load, so a store written before boot is overwritten or leaves
 * the app with no settings and a blank page (see e2e/README.md).
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

test.describe('Admin — Localities', () => {
  test('a listing the catalogue could not place is waiting here, with the text its owner typed', async ({ page, login, consoleErrors }) => {
    await login.asAdmin();
    await unfile(page, { title: 'Zztest Unfiled Flat', locality: 'Undhera Wasti', status: 'pending' });
    await page.goto('/admin/localities');

    await expect(page.getByRole('heading', { name: 'Localities' })).toBeVisible();
    // The free text is what makes the row decidable — a title and a pin is guessing.
    await expect(row(page, 'Zztest Unfiled Flat')).toContainText('Undhera Wasti');
    await expect(kpi(page, 'Awaiting a locality')).toContainText('1');
    expect(consoleErrors).toEqual([]);
  });

  test('an approved listing nobody can find is called out separately from the backlog', async ({ page, login }) => {
    await login.asAdmin();
    await unfile(page, { title: 'Zztest Live Flat', locality: 'Undhera Wasti', status: 'approved' });
    await page.goto('/admin/localities');

    /* An approved listing with no locality is live *and* absent from every locality surface — it is
       failing buyers now, where a pending one is only about to. The tile exists so that number is
       not averaged away into a backlog total that is never zero. */
    await expect(kpi(page, 'Live and unfindable')).toContainText('1');
    await expect(row(page, 'Zztest Live Flat')).toContainText('Live · unfindable');
  });

  test('filing a listing under an area clears it from the queue', async ({ page, login }) => {
    await login.asAdmin();
    await unfile(page, { title: 'Zztest Unfiled Flat', locality: 'Undhera Wasti', status: 'pending' });
    await page.goto('/admin/localities');

    await row(page, 'Zztest Unfiled Flat').getByRole('combobox').selectOption('baner');
    await row(page, 'Zztest Unfiled Flat').getByRole('button', { name: 'Assign' }).click();

    await expect(page.getByText(/filed under Baner/i).first()).toBeVisible();
    // Gone from the queue is the assertion that matters: a toast with no write behind it would
    // pass a weaker test.
    await expect(row(page, 'Zztest Unfiled Flat')).toHaveCount(0);
    await expect(kpi(page, 'Awaiting a locality')).toContainText('0');
  });

  test('there is no way to mark a row reviewed while leaving it unfiled', async ({ page, login }) => {
    await login.asAdmin();
    await unfile(page, { title: 'Zztest Unfiled Flat', locality: 'Undhera Wasti', status: 'pending' });
    await page.goto('/admin/localities');

    /* The deleted Dismiss button is the reason this assertion exists. "Reviewed, still has no
       locality" is the exact state the queue was opened to end, so an action producing it would
       reduce the server's approval refusal back to the warning it replaced. */
    await expect(row(page, 'Zztest Unfiled Flat').getByRole('button', { name: /dismiss/i })).toHaveCount(0);
    await expect(row(page, 'Zztest Unfiled Flat').getByRole('button', { name: /verify/i })).toHaveCount(0);
  });

  test('the Directory tab lists the areas listings can be filed under', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/localities?tab=directory');

    // Read through the seam, not the bundled data module — an area added in the console has to show
    // up here without a release.
    await expect(row(page, 'Baner').first()).toContainText('Live');
  });

  test('KPI tiles double as tab shortcuts', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/localities');

    await kpi(page, 'Localities').click();
    await expect(page).toHaveURL(/tab=directory/);
  });

  test('an empty queue says every listing is findable, rather than rendering a blank table', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/localities');

    // Nothing is unfiled in the seeded store, so this is the default state.
    await expect(table(page).getByText(/Nothing awaiting a locality/i)).toBeVisible();
  });

  test('an unauthenticated visitor is redirected to staff-login', async ({ page }) => {
    await page.goto('/admin/localities');
    await page.waitForURL('**/staff-login**');
    expect(new URL(page.url()).pathname).toBe('/staff-login');
  });
});
