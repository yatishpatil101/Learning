// @ts-check
import { test, expect } from '@playwright/test';
import { appReady } from '../../../helpers/app.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const OWNER = { name: 'Owner Test', mobile: '9800000001', email: '', role: 'owner', joinedAt: Date.now() };
const SEEKER = { name: 'Seeker Test', mobile: '9700000002', email: '', role: 'user', joinedAt: Date.now() };

const LISTING = {
  id: 'L-TEST-1', title: 'Test 2 BHK, Baner', locality: 'Baner', deal: 'rent',
  price: 25000, status: 'approved', real: true, ownerMobile: '9800000001', views: 7,
};

// A pending phone-number request that is 4 days old -> must surface as STALE.
const STALE_CONTACT = [{
  id: 'c-stale', propId: 'L-TEST-1', buyerName: 'Priya K', buyerMobile: '9700000009',
  status: 'pending', requestedAt: Date.now() - 4 * 86400000,
}];

async function seedOwner(page, { contact } = {}) {
  await page.addInitScript(({ u, l, c }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    localStorage.setItem('puneNestListings:' + u.mobile, JSON.stringify(l));
    if (c) localStorage.setItem('puneNestContactReq:' + u.mobile, JSON.stringify(c));
  }, { u: OWNER, l: [LISTING], c: contact || null });
}

async function seedSeeker(page) {
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
  }, SEEKER);
}

/* Put the listing where the dashboard actually looks for one.

   The Action Center's owner rows are gated on `isOwner`, which is `listings.length > 0`, and
   `listings` comes from `propertyService.myListings` now. The mock behind that seam resolves the
   *catalogue* (`puneNestDB_v5`) and keeps rows marked `real` whose owner matches — it does not read
   `puneNestListings:<mobile>` any more. Seeding only the per-owner key left the owner with no
   inventory, so `isOwner` was false, no contact row was ever built, and the Action Center rendered
   "You're all caught up" while a four-day-old request sat in the store.

   It has to run after boot: the app seeds `puneNestDB_v5` itself on first load and would overwrite
   an `addInitScript` write. Same shape as `publishToCatalogue` in dashboard.spec.js, which hit this
   first. */
async function publishToCatalogue(page, listing, mobile) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await appReady(page);
  await page.evaluate(({ l, m }) => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing after appReady()');
    const db = JSON.parse(raw);
    db.listings = [{ ...l, ownerMobile: m, real: true }, ...(db.listings || []).filter((p) => p.id !== l.id)];
    localStorage.setItem(KEY, JSON.stringify(db));
  }, { l: listing, m: mobile });
}

test.describe('Dashboard Action Center', () => {
  test('owner with a stale pending request sees a prioritized "Needs your attention" card', async ({ page }) => {
    await seedOwner(page, { contact: STALE_CONTACT });
    await publishToCatalogue(page, LISTING, OWNER.mobile);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

    const ac = page.locator('[data-testid="action-center"]');
    await expect(ac).toBeVisible();
    await expect(page.getByText('Needs your attention')).toBeVisible();

    // The 4-day-old contact request must be present with an escalation pill,
    // and it must sort to the very top (stale-first).
    const items = page.locator('[data-testid="action-item"]');
    await expect(items.first()).toContainText(/wants your phone number/i);
    await expect(items.first()).toContainText(/4d waiting/i);

    // Its primary CTA resolves the request and removes that specific row.
    const contactRow = items.filter({ hasText: /wants your phone number/i });
    await expect(contactRow).toHaveCount(1);
    await contactRow.getByRole('button', { name: /Share/i }).click();
    await expect(contactRow).toHaveCount(0);
  });

  test('the Requests sidebar badge reflects pending count from any tab', async ({ page }) => {
    await seedOwner(page, { contact: STALE_CONTACT });
    await publishToCatalogue(page, LISTING, OWNER.mobile);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

    const requestsBtn = page.locator('aside button', { hasText: 'Requests' }).first();
    await expect(requestsBtn).toContainText('1');
  });

  test('a seeker sees only shared visit items, never owner-only actions', async ({ page }) => {
    await seedSeeker(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

    // Owner-only obligations must never leak to a seeker.
    await expect(page.getByText(/wants your phone number/i)).toHaveCount(0);
    await expect(page.getByText(/Group wants to rent/i)).toHaveCount(0);
    await expect(page.getByText(/asked for more photos/i)).toHaveCount(0);
  });

  test('the "all caught up" state shows when nothing is pending', async ({ page }) => {
    await seedSeeker(page);
    // Seed the store first, then clear the shared visits collection so this
    // seeker genuinely has zero pending items.
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await appReady(page);
    await page.evaluate(() => {
      const KEY = 'puneNestDB_v5';
      const raw = localStorage.getItem(KEY);
      // No `|| '{}'`. This is a read-modify-write, so an empty fallback does not degrade
      // gracefully — it writes the empty object back and wipes the store, which then shows
      // up several assertions later as a mystery about visits.
      if (!raw) throw new Error('mock store missing after appReady()');
      const db = JSON.parse(raw);
      db.visits = [];
      localStorage.setItem(KEY, JSON.stringify(db));
    });
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.locator('[data-testid="action-center"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="action-center-clear"]')).toBeVisible();
  });
});
