// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Ops "Duplicates" merge UI (end-to-end).
 *
 * Seeds two active listings by DIFFERENT owners at the same physical address into
 * the shared mock DB, opens Admin → Properties → Duplicates, and confirms the pair
 * surfaces as one cluster that Ops can resolve by keeping one and archiving the
 * other.
 */

const BASE = 'http://localhost:5173';
const SOCIETY = 'ZZ Ops Merge Society';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

function seedCluster(page) {
  return page.addInitScript((society) => {
    const KEY = 'puneNestDB_v5';
    let db = {};
    try { db = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { db = {}; }
    db.listings = db.listings || [];
    if ((db.listings || []).some((l) => l.id === 'MERGE-A')) return; // idempotent across navigations
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

test('Ops can merge a cross-owner duplicate cluster from the Duplicates tab', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await seedCluster(page);
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/properties`);
  await page.waitForTimeout(1000);

  // Open the Duplicates tab (label carries the live count, e.g. "Duplicates (1)").
  await page.getByRole('tab', { name: /Duplicates/i }).click();
  await page.waitForTimeout(400);

  // The cluster shows both listings side-by-side.
  await expect(page.getByText('2 BHK by Owner A')).toBeVisible();
  await expect(page.getByText('2 BHK by Owner B')).toBeVisible();
  await expect(page.getByText(/2 listings/i)).toBeVisible();

  // Keep Owner B's listing → Owner A's is archived as a merged duplicate.
  const keepButtons = page.getByRole('button', { name: /Keep this, archive the rest/i });
  await keepButtons.nth(0).click(); // first column is the NEWEST (Owner B).
  await page.waitForTimeout(600);

  // The cluster is resolved and disappears from the tab.
  await expect(page.getByText(/No duplicate clusters/i)).toBeVisible({ timeout: 5000 });

  // DB reflects the merge: the dropped listing is archived, the kept one is clean.
  const state = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
    const byId = (id) => (db.listings || []).find((l) => l.id === id) || {};
    return { a: byId('MERGE-A'), b: byId('MERGE-B') };
  });
  expect(state.a.archived).toBe(true);
  expect(state.b.archived).toBeFalsy();
  expect(state.b.duplicateFlag).toBeFalsy();

  expect(errors).toHaveLength(0);
});
