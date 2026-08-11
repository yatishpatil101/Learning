import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* Phase B/C — community-locality mint layer (the "locality graph").
   Mirrors the community-society pattern: a listing whose picked locality matches
   no canonical locality MINTS a community-tier locality (system of record), which
   is persisted, registered into the canonical registry so every lookup resolves
   it, and dropped into the ops queue for promotion to `curated`.

   Test 1 drives the store/registry contract directly (Vite dev serves ESM source,
   so we can import the real modules in the page). Test 2 covers the admin ops
   loop UI (pending queue → Verify promotes → leaves the queue). */

const BASE = 'http://localhost:5173';

test('unmatched locality mints a community locality, registers it, and verify promotes it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(BASE);

  const res = await page.evaluate(async () => {
    const store = await import('/src/lib/store.js');
    const loc = await import('/src/data/localities.js');
    const NAME = 'Zzytest Nagar';
    const SLUG = 'zzytest-nagar';
    // Clean any prior run so the assertions are deterministic.
    store.dismissCommunityLocality(SLUG);

    // A never-seen name at coords far from every Pune locality (>2.5km) matches nothing.
    const canon = loc.matchLocalityToCanonical(NAME, 30, 80);

    const minted = store.addCommunityLocality({ name: NAME, lat: 30, lng: 80, pincode: '411999', source: 'listing' });
    const registered = loc.localityBySlug(minted.slug); // now resolvable in the canonical registry
    const rematch = loc.matchLocalityToCanonical(NAME); // name now resolves to the minted canonical
    const pending = store.pendingCommunityLocalities().map((l) => l.slug);
    const lead = store.getLocalityLeads().find((l) => l.slug === SLUG);

    // Re-minting the same pick is idempotent (no duplicate row).
    store.addCommunityLocality({ name: NAME, lat: 30, lng: 80, source: 'listing' });
    const countAfterDup = store.getCommunityLocalities().filter((l) => l.slug === SLUG).length;

    // Ops promotes it → curated, leaves the pending queue, still resolvable.
    store.verifyCommunityLocality(SLUG, 'ops');
    const tierAfter = loc.localityBySlug(SLUG).tier;
    const pendingAfter = store.pendingCommunityLocalities().map((l) => l.slug);

    store.dismissCommunityLocality(SLUG); // cleanup persisted state
    return {
      canon, mintedSlug: minted.slug, registeredName: registered && registered.name,
      rematchSlug: rematch && rematch.slug, pending, hasLead: !!lead, countAfterDup, tierAfter, pendingAfter,
    };
  });

  expect(res.canon).toBeNull();
  expect(res.mintedSlug).toBe('zzytest-nagar');
  expect(res.registeredName).toBe('Zzytest Nagar');
  expect(res.rematchSlug).toBe('zzytest-nagar');
  expect(res.pending).toContain('zzytest-nagar');
  expect(res.hasLead).toBe(true);
  expect(res.countAfterDup).toBe(1);
  expect(res.tierAfter).toBe('curated');
  expect(res.pendingAfter).not.toContain('zzytest-nagar');
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('admin Localities queue lists a pending community locality and Verify promotes it', async ({ page }) => {
  const errors = trackErrors(page);
  // Seed a pending community locality before the app loads; store.js rehydrates
  // the registry from this key at module load.
  await page.addInitScript(() => {
    localStorage.setItem('pnCommunityLocalities', JSON.stringify([
      { slug: 'testmint-nagar', name: 'Testmint Nagar', lat: 18.7, lng: 73.6, pincode: '411999', tier: 'community', source: 'listing', by: '', at: Date.now() },
    ]));
  });

  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
  await page.goto(`${BASE}/admin/localities`);

  await expect(page.getByRole('heading', { name: 'Localities' })).toBeVisible({ timeout: 5000 });
  /* `Table` renders a desktop <table> AND a hidden `.pn-card` stack for phones, so
     an unscoped getByText matches twice and trips strict mode. Scope to the table —
     this spec runs on desktop. */
  const row = page.getByRole('table').locator('tr').filter({ hasText: 'Testmint Nagar' });
  await expect(row).toHaveCount(1, { timeout: 5000 });

  await row.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText(/promoted to a curated locality/i).first()).toBeVisible({ timeout: 5000 });
  // It leaves the pending queue.
  await expect(page.getByRole('table').locator('tr').filter({ hasText: 'Testmint Nagar' })).toHaveCount(0, { timeout: 5000 });

  expect(errors, errors.join('\n')).toHaveLength(0);
});
