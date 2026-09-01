// @ts-check
import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';
import { appReady } from '../../../helpers/app.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OWNER = { name: 'Owner Test', mobile: '9811100011', email: '', role: 'owner', joinedAt: Date.now() };
const PROP_ID = 'PN-OWN-REAL';

/* isOwner is derived from the listings the property seam returns, not the user's role field — so
   the dashboard routes to the owner P&L (OwnerFinances) rather than the tenant Rent Wallet. */
async function loginOwner(page) {
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    localStorage.setItem('puneNestListings:' + u.mobile, JSON.stringify([
      { id: 'PN-OWN-1', title: 'Test Flat, Baner', ownerMobile: u.mobile, real: true, status: 'approved' },
    ]));
  }, OWNER);
}

/* ...and the seam reads the catalogue, not `puneNestListings:<mobile>`, which is why the key above
   is no longer enough on its own. Without this the owner had no inventory, Finances fell through to
   the tenant Rent Wallet, and every assertion here was made against the wrong screen.

   Post-boot, because the app seeds `puneNestDB_v5` on first load and would clobber an init script.
   The third test in this file already did this by hand for its overdue-dues fixture; this is the
   same write, hoisted so the two tests that only need ownership can share it. */
async function ownListing(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await appReady(page);
  await page.evaluate(({ mob, propId }) => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing after appReady()');
    const db = JSON.parse(raw);
    db.listings = [
      {
        id: propId, title: 'Owned 2 BHK, Baner', ownerMobile: mob, real: true, status: 'approved',
        deal: 'rent', locality: 'Baner', bhk: '2 BHK', price: 28000, createdAt: Date.now(),
      },
      ...(db.listings || []).filter((p) => p.id !== propId),
    ];
    localStorage.setItem(KEY, JSON.stringify(db));
  }, { mob: OWNER.mobile, propId: PROP_ID });
}

test.describe('Dashboard — owner Finances (property P&L)', () => {
  test('renders KPI tiles and the Set-up-ROI CTA in place of a blank tile', async ({ page }) => {
    const errors = trackErrors(page);
    await loginOwner(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await ownListing(page);
    await page.goto(`${BASE}/dashboard#finances`, { waitUntil: 'networkidle' });

    // On mobile the KPI carousel is the visible copy (the desktop grid is lg-only).
    await expect(page.getByText('Rent collected').first()).toBeVisible();
    await expect(page.getByText('Net cashflow').first()).toBeVisible();
    // Missing ownership basis => the ROI CTA replaces the old dead "—" tile.
    await expect(page.getByRole('button', { name: /Set up ROI/ }).first()).toBeVisible();
    // Detail is grouped under tabs; Activity is the default.
    await expect(page.getByRole('tab', { name: 'Activity' })).toBeVisible();
    // At-a-glance health chip is always visible in the header.
    await expect(page.getByText('Healthy')).toBeVisible();

    expect(errors, 'console errors on owner Finances').toEqual([]);
  });

  test('opens the Add-transaction modal from the Activity tab', async ({ page }) => {
    await loginOwner(page);
    await ownListing(page);
    await page.goto(`${BASE}/dashboard#finances`, { waitUntil: 'networkidle' });

    await page.getByRole('tab', { name: 'Activity' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add transaction' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Recurring (monthly)')).toBeVisible();
  });

  test('promotes overdue dues into an Action-required strip with real labels', async ({ page }) => {
    await loginOwner(page);
    // Seed the mock DB (after hydrate) with an owned listing + a recurring OVERDUE
    // transaction so getDues() produces a due and the promoted strip renders.
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await appReady(page);
    await page.evaluate(({ mob, propId }) => {
      const KEY = 'puneNestDB_v5';
      // No `|| '{"listings":[]}'`. This is a read-modify-write, so the fallback does not
      // degrade gracefully — it writes a one-key DB back over the real one, and the loss of
      // settings/societies surfaces much later as an unrelated blank screen.
      const raw = localStorage.getItem(KEY);
      if (!raw) throw new Error('mock store missing after appReady()');
      const db = JSON.parse(raw);
      db.listings = db.listings || [];
      db.listings.unshift({
        id: propId, title: 'Owned 2 BHK, Baner', ownerMobile: mob, real: true, status: 'approved',
        deal: 'rent', locality: 'Baner', bhk: '2 BHK', price: 28000, createdAt: Date.now(),
      });
      localStorage.setItem(KEY, JSON.stringify(db));
      const now = new Date();
      const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const iso = last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0') + '-01';
      localStorage.setItem('puneNestFin:' + mob + ':' + propId, JSON.stringify([
        { id: 't1', type: 'income', category: 'Rent received', amount: 25000, date: iso, repeat: 'monthly', note: 'Flat 2B', createdAt: Date.now() },
      ]));
    }, { mob: OWNER.mobile, propId: PROP_ID });

    await page.goto(`${BASE}/dashboard#finances`, { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Action required' })).toBeVisible();
    // Old bug rendered "undefined — ... due undefined"; assert real fields instead.
    await expect(page.getByText('Rent received — Flat 2B').first()).toBeVisible();
    await expect(page.getByText(/days? overdue/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('undefined');
  });

  /* D178 — "This year" is the Indian financial year on both halves of this screen.
     The KPI strip took its window from the server (1 April) while the ledger directly below it
     derived its own and pivoted on 1 January, so between January and March one screen answered the
     same question two ways.

     **The clock is pinned to February on purpose.** Only January–March separates the two pivots:
     run this in June and both answer identically, every assertion passes with the bug present, and
     the test is worth nothing. */
  test('"This year" spans the financial year, so the KPI and the ledger below it agree', async ({ page }) => {
    await loginOwner(page);
    await page.clock.setFixedTime(new Date('2026-02-15T10:00:00+05:30'));
    // The KPI strip renders twice — a mobile carousel and an lg-only grid — and only one is
    // visible. Pin a desktop width so "visible" means the grid, and filter on it below.
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await appReady(page);
    await page.evaluate(({ mob, propId }) => {
      const KEY = 'puneNestDB_v5';
      // Read-modify-write — see the note above; an empty fallback would wipe the store.
      const raw = localStorage.getItem(KEY);
      if (!raw) throw new Error('mock store missing after appReady()');
      const db = JSON.parse(raw);
      db.listings = db.listings || [];
      db.listings.unshift({
        id: propId, title: 'Owned 2 BHK, Baner', ownerMobile: mob, real: true, status: 'approved',
        deal: 'rent', locality: 'Baner', bhk: '2 BHK', price: 28000, createdAt: Date.now(),
      });
      localStorage.setItem(KEY, JSON.stringify(db));
      /* Four rows, chosen so the two pivots cannot produce the same answer and so income,
         expense and net are three *different* figures — with no expense, the Collected and Net
         tiles read the same number and an assertion on one silently matches the other.
         Jun 2025 is inside this FY but in *last* calendar year — the row a 1-January pivot drops.
         Jan 2026 is inside both. Feb 2025 is inside neither and must never appear. */
      localStorage.setItem('puneNestFin:' + mob + ':' + propId, JSON.stringify([
        { id: 'fy1', type: 'income', category: 'Rent received', amount: 30000, date: '2025-06-05', repeat: 'none', note: 'Jun rent', createdAt: 1 },
        { id: 'fy2', type: 'income', category: 'Rent received', amount: 20000, date: '2026-01-05', repeat: 'none', note: 'Jan rent', createdAt: 2 },
        { id: 'fy3', type: 'income', category: 'Rent received', amount: 40000, date: '2025-02-05', repeat: 'none', note: 'Old FY rent', createdAt: 3 },
        { id: 'fy4', type: 'expense', category: 'Repairs', amount: 5000, date: '2025-09-10', repeat: 'none', note: 'Sep repair', createdAt: 4 },
      ]));
    }, { mob: OWNER.mobile, propId: PROP_ID });

    await page.goto(`${BASE}/dashboard#finances`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Activity' }).click();

    // The period control is a custom listbox; its trigger reads as the current selection.
    await page.getByRole('button', { name: 'All time', exact: true }).click();
    await page.getByRole('option', { name: 'This year', exact: true }).click();

    /* The ledger. Jun 2025 and Sep 2025 are the rows that separate the pivots — with a 1-January
       window they vanish, and these are the assertions that fail. */
    await expect(page.getByText('Rent received — Jun rent')).toBeVisible();
    await expect(page.getByText('Rent received — Jan rent')).toBeVisible();
    await expect(page.getByText('Repairs — Sep repair')).toBeVisible();
    await expect(page.getByText('Rent received — Old FY rent')).toHaveCount(0);

    /* The KPI strip above it, counted over the same window: collected 30,000 + 20,000, spent
       5,000, net 45,000 — not the 20,000 / 0 / 20,000 a calendar year would report.
       `exact` matters — the ledger renders its own amounts as `+₹20,000`, so a substring match
       would find the row and pass whatever the KPI says. */
    const kpi = (amount) => page.getByText(amount, { exact: true }).filter({ visible: true });
    await expect(kpi('₹50,000')).toHaveCount(1);
    await expect(kpi('₹5,000')).toHaveCount(1);
    await expect(kpi('₹45,000')).toHaveCount(1);
    await expect(kpi('₹20,000')).toHaveCount(0);
  });
});
