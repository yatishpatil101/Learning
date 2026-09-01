// @ts-check
import { test, expect } from '../../fixtures/base.js';

/**
 * Ops "Duplicates" merge UI (end-to-end).
 *
 * MOCK-ONLY, and not by preference — the feature under test does not exist on a live build.
 *
 * D249 measured the tab against the server and found it answering from the browser: with 71
 * listings on the server, four of whose titles repeated, the Duplicate KPI painted `0`, because
 * `findDuplicateClusters()` runs a union-find over the seeded `puneNestDB_v5` fixture rather than
 * over anything the server returned. `resolveDuplicate` was the same shape in reverse — it
 * "archived" the loser into `localStorage`, where no operator and no auditor would ever find it.
 * The tile, the tab, its count and this panel are now gated out of live builds behind
 * `DUPLICATES_ARE_REAL` in `pages/admin/AdminProperties.jsx`, and their absence is asserted in
 * `live-properties-console.spec.js`.
 *
 * So this file stays on the mock provider because the control it drives is only reachable there.
 * That makes it a regression test for the un-gated branch, not a claim about production: nothing
 * here is evidence that duplicate detection works for a real operator on real listings, and it
 * should not be read that way. It becomes convertible the day `GET /admin/listings/duplicates`
 * and a server-side merge exist — see the Duplicates row in `tasks/DECISIONS-NEEDED.md`.
 *
 * Seeds two active listings by DIFFERENT owners at the same physical address into
 * the shared mock DB, opens Admin → Properties → Duplicates, and confirms the pair
 * surfaces as one cluster that Ops can resolve by keeping one and archiving the
 * other.
 *
 * Converted to the shared `login` / `consoleErrors` fixtures and relative paths; the hardcoded
 * `http://localhost:5173` ignored `BASE_URL`. Three `waitForTimeout` calls are gone, replaced by
 * the assertions they were standing in for.
 */

const SOCIETY = 'ZZ Ops Merge Society';

async function seedCluster(page) {
  await page.evaluate((society) => {
    const KEY = 'puneNestDB_v5';
    // No `|| '{}'` and no `catch { db = {} }`. This is a read-modify-write, so an empty
    // fallback is written back over the seeded catalogue and the Duplicates tab then has
    // nothing to cluster — which reads as a merge-UI bug rather than a missing store.
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing');
    const db = JSON.parse(raw);
    db.listings = db.listings || [];
    if ((db.listings || []).some((l) => l.id === 'MERGE-A')) return; // idempotent
    const base = {
      deal: 'rent', society, flatNumber: 'A-707', pincode: '411057', locality: 'Wakad',
      status: 'approved', price: '\u20b925,000/mo',
    };
    db.listings.unshift(
      { ...base, id: 'MERGE-A', title: '2 BHK by Owner A', ownerMobile: '9000000001', owner: 'Owner A', createdAt: Date.now() - 86400000, duplicateFlag: true, duplicateOf: '', flagReason: 'Possible duplicate \u2014 same address / electricity meter as another owner\u2019s active listing.', status: 'flagged' },
      { ...base, id: 'MERGE-B', title: '2 BHK by Owner B', ownerMobile: '9000000002', owner: 'Owner B', createdAt: Date.now() },
    );
    localStorage.setItem(KEY, JSON.stringify(db));
  }, SOCIETY);
}

test('Ops can merge a cross-owner duplicate cluster from the Duplicates tab', async ({ page, login, consoleErrors }) => {
  // Log in first so the app boots and seeds the FULL default DB into puneNestDB_v5,
  // then merge our two listings into it. Seeding before boot would write a partial
  // DB (only `listings`) and crash the app on load.
  await login.asAdmin();
  await seedCluster(page);
  await page.goto('/admin/properties');

  // Open the Duplicates tab (label carries the live count, e.g. "Duplicates (1)").
  const tab = page.getByRole('tab', { name: /Duplicates/i });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');

  // The cluster shows both listings side-by-side.
  await expect(page.getByText('2 BHK by Owner A')).toBeVisible();
  await expect(page.getByText('2 BHK by Owner B')).toBeVisible();
  await expect(page.getByText(/2 listings/i)).toBeVisible();

  // Keep Owner B's listing → Owner A's is archived as a merged duplicate.
  const keepButtons = page.getByRole('button', { name: /Keep this, archive the rest/i });
  await keepButtons.nth(0).click(); // first column is the NEWEST (Owner B).

  // The cluster is resolved and disappears from the tab.
  await expect(page.getByText(/No duplicate clusters/i)).toBeVisible();

  // DB reflects the merge: the dropped listing is archived, the kept one is clean.
  const state = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
    const byId = (id) => (db.listings || []).find((l) => l.id === id) || {};
    return { a: byId('MERGE-A'), b: byId('MERGE-B') };
  });
  expect(state.a.archived).toBe(true);
  expect(state.b.archived).toBeFalsy();
  expect(state.b.duplicateFlag).toBeFalsy();

  expect(consoleErrors).toHaveLength(0);
});
