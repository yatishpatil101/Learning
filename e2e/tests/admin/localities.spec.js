import { test, expect } from '../../fixtures/base.js';

/* /admin/localities — the locality registry desk.
 *
 * `community-locality` asserts the happy path (a pending locality appears and
 * Verify promotes it). Everything else on the page was untested: the Dismiss
 * branch, the Directory tab, the KPI tiles that double as tab shortcuts, the
 * empty state, and the role guard.
 *
 * Dismiss matters more than it looks: it is the only way a typo'd auto-minted
 * locality leaves the queue, and a regression there means the queue fills with
 * junk until nobody reads it.
 *
 * `Table` renders BOTH a desktop <table> and a stacked `.pn-card` list for
 * phones, hiding one with CSS. Assertions therefore have to name a surface — an
 * unscoped getByText matches twice and trips strict mode, or resolves to the
 * hidden copy and fails against correct markup. These specs run on desktop, so
 * they scope to the table.
 */

const PENDING = [
  { slug: 'zztest-alpha', name: 'Zztest Alpha', lat: 18.71, lng: 73.61, pincode: '411997', tier: 'community', source: 'listing', by: '', at: Date.now() },
  { slug: 'zztest-beta', name: 'Zztest Beta', lat: 18.72, lng: 73.62, pincode: '411996', tier: 'community', source: 'listing', by: '', at: Date.now() },
];

const seedPending = (page, rows = PENDING) => page.addInitScript((seeded) => {
  localStorage.setItem('pnCommunityLocalities', JSON.stringify(seeded));
}, rows);

const table = (page) => page.getByRole('table');
const row = (page, name) => table(page).locator('tr').filter({ hasText: name });

test.describe('Admin — Localities', () => {
  test('KPI tiles count the registry and jump to the matching tab', async ({ page, login, consoleErrors }) => {
    await seedPending(page);
    await login.asAdmin();
    await page.goto('/admin/localities');

    await expect(page.getByRole('heading', { name: 'Localities' })).toBeVisible();
    // Two seeded community localities await review.
    await expect(page.locator('.pn-card', { hasText: 'Pending review' })).toContainText('2');

    // Clicking a tile is a shortcut to its tab, so the count is actionable.
    await page.locator('.pn-card', { hasText: 'Curated' }).first().click();
    await expect(page).toHaveURL(/tab=directory/);
    expect(consoleErrors).toEqual([]);
  });

  test('Dismiss removes a bogus locality from the queue without promoting it', async ({ page, login }) => {
    await seedPending(page);
    await login.asAdmin();
    await page.goto('/admin/localities');

    await expect(row(page, 'Zztest Beta')).toHaveCount(1);

    // Dismiss the second row specifically — the first must be left alone.
    await row(page, 'Zztest Beta').getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText(/dismissed/i).first()).toBeVisible();
    await expect(row(page, 'Zztest Beta')).toHaveCount(0);
    await expect(row(page, 'Zztest Alpha')).toHaveCount(1);

    // Dismissed ≠ promoted: it must not appear in the curated directory either.
    await page.goto('/admin/localities?tab=directory');
    await expect(row(page, 'Zztest Beta')).toHaveCount(0);
  });

  test('the Directory tab lists curated localities and separates them by tier', async ({ page, login }) => {
    await seedPending(page);
    await login.asAdmin();
    await page.goto('/admin/localities?tab=directory');

    // The curated seed set is what every search, filter and SEO page keys off.
    await expect(row(page, 'Baner').first()).toContainText('Curated');

    /* The two seeded community localities are in the directory but past the
       10-row page, so assert the split through the KPI counts instead of paging:
       total minus curated is exactly the community tier. */
    const count = async (label) => Number(
      (await page.locator('.pn-card', { hasText: label }).first().innerText()).match(/\d[\d,]*/)[0].replace(/,/g, ''),
    );
    expect(await count('Localities') - await count('Curated')).toBe(2);
  });

  test('an empty review queue says so rather than rendering a blank table', async ({ page, login }) => {
    await seedPending(page, []);
    await login.asAdmin();
    await page.goto('/admin/localities');

    await expect(table(page).getByText(/No community localities awaiting review/i)).toBeVisible();
  });

  test('an unauthenticated visitor is redirected to staff-login', async ({ page }) => {
    await page.goto('/admin/localities');
    await page.waitForURL('**/staff-login**');
    expect(new URL(page.url()).pathname).toBe('/staff-login');
  });
});
