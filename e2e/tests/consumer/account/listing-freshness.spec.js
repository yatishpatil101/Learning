import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { trackErrors } from '../../../helpers/console.js';

/* Listing Freshness / anti-staleness system.
   - Owner: aging/stale listings show a "Confirm available" CTA; dormant ones show
     "Reactivate" + "WhatsApp reminder"; confirming resets them to Active.
   - Buyer: the property detail page surfaces an owner-activity signal, and dormant
     listings are hidden from public search entirely. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const USER_MOBILE = '9800011122';

const SEED_DB = JSON.parse(
  readFileSync(new URL('../../../../frontend/src/data/db.json', import.meta.url), 'utf-8'),
);

const dISO = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

/* A minimal approved+real listing shaped like the "Post a property" flow persists. */
const base = (over) => ({
  bhk: '2 BHK', bhkNum: 2, bath: 2, locality: 'Baner', localitySlug: 'baner',
  loc: 'Baner, Pune', society: '', deal: 'buy', owner: 'Fresh Owner', ownerMobile: USER_MOBILE,
  status: 'approved', statusClass: 'pill-approved', real: true, featured: false, views: 3,
  enquiries: 0, photoCount: 0, furnishing: 'unfurnished', facing: '', floor: 0, age: '',
  construction: 'ready', amenities: [], img: '', image: '', gallery: [], desc: '',
  type: 'Flat', area: 1500, price: 8000000, priceStr: '₹80 Lacs', createdAt: dISO(40), ...over,
});

async function seed(page) {
  const db = { ...SEED_DB };
  // FRESH/STALE are marked featured only so they deterministically land on page 1
  // under the listings' real relevance sort (featured has no visual effect on tiles).
  // DORM-1 is intentionally left un-featured — it must stay hidden from buyers.
  const owned = [
    base({ id: 'FRESH-1', title: 'Fresh Flat in Baner', freshenedAt: dISO(0), featured: true }),
    base({ id: 'STALE-1', title: 'Stale Flat in Baner', freshenedAt: dISO(20), featured: true }),
    base({ id: 'DORM-1', title: 'Dormant Flat in Baner', freshenedAt: dISO(45) }),
  ];
  db.listings = [...owned, ...(SEED_DB.listings || [])];
  await page.addInitScript(
    ([key, value, mobile, ownedJson]) => {
      // Mirror the real "Post a property" flow, which writes to BOTH the public
      // mock-API catalog (puneNestDB_v5) AND the per-user store
      // (puneNestListings:<mobile>). The per-user key is what drives the
      // inventory-based owner gating (hasListings()), so seeding only the public
      // catalog would leave the owner un-gated and hide the My Listings surface.
      localStorage.setItem(key, value);
      localStorage.setItem('puneNestListings:' + mobile, ownedJson);
      localStorage.setItem('puneNest_conciergeSeeded_v1', '1');
      // Owner role so the My Listings tab is available deterministically.
      localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Fresh Owner', mobile, role: 'owner', loginAt: Date.now() }));
      localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
    },
    ['puneNestDB_v5', JSON.stringify(db), USER_MOBILE, JSON.stringify(owned)],
  );
}

test('owner sees freshness pills + confirm/reactivate/WhatsApp actions, and "Confirm all" clears them', async ({ page }) => {
  const errors = trackErrors(page);

  await seed(page);
  await page.goto(`${BASE}/dashboard#listings`);

  // Freshness pills reflect the derived state.
  await expect(page.getByText('Stale', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();

  // Contextual owner actions.
  await expect(page.getByRole('button', { name: /Confirm available/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Reactivate/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /WhatsApp reminder/i }).first()).toBeVisible();

  // Nudge banner + one-click confirm-all.
  await expect(page.getByText(/need.* your confirmation/i)).toBeVisible();
  await page.getByRole('button', { name: /Confirm all available/i }).click();

  /* Everything is Active now. The `Active` pill is asserted *first*: the two `toHaveCount(0)` claims
     below pass for free against a page that has not re-rendered yet -- or has fallen over -- so the
     positive anchor is what makes them mean "gone because confirmed" rather than "not there yet". */
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/need.* your confirmation/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Reactivate/i })).toHaveCount(0);

  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('dormant listings are hidden from public search but fresh ones show', async ({ page }) => {
  await seed(page);
  await page.goto(`${BASE}/listings?deal=buy`);
  await expect(page.locator('a[href="/property/FRESH-1"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('a[href="/property/STALE-1"]')).toBeVisible();
  // The dormant listing (owner went dark) must not be visible to buyers.
  await expect(page.locator('a[href="/property/DORM-1"]')).toHaveCount(0);
});

test('listing-page tiles show "Posted …" and never the freshness label', async ({ page }) => {
  await seed(page);
  await page.goto(`${BASE}/listings?deal=buy`);
  await expect(page.locator('a[href="/property/FRESH-1"]')).toBeVisible({ timeout: 15000 });
  // Freshness cues belong on the property details page, not on result tiles.
  await expect(page.getByText('Availability not recently confirmed')).toHaveCount(0);
  await expect(page.getByText('Confirmed available')).toHaveCount(0);
  // The classic "Posted …" recency line is back on the tiles.
  await expect(page.locator('a[href="/property/FRESH-1"]').getByText(/Posted/)).toBeVisible();
});

test('buyer property detail shows the owner-activity signal', async ({ page }) => {
  await seed(page);
  // View as a buyer (not the owner) — this signal is a buyer-facing trust cue.
  await page.addInitScript(() => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Buyer Bob', mobile: '9777788899', role: 'buyer', loginAt: Date.now() }));
  });

  await page.goto(`${BASE}/property/FRESH-1`);
  await expect(page.getByText(/actively managed/i)).toBeVisible({ timeout: 15000 });

  await page.goto(`${BASE}/property/STALE-1`);
  await expect(page.getByText(/still available/i).first()).toBeVisible({ timeout: 15000 });
});

