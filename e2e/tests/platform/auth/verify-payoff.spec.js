import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { trackErrors } from '../../../helpers/console.js';

/* The verify funnel's *payoff* — tech-debt D95.
 *
 * `kyc-growth-levers.spec.js` already drives modal → DigiLocker mock → badge
 * earned → CTA auto-hides. What no spec covered is what happens to the owner's
 * **listings** at the moment the badge lands, which is the half the whole
 * badge-not-gate model rests on: if verifying does not visibly pay off, the
 * "verified listings rank higher" promise is hollow and the funnel is a form
 * that does nothing.
 *
 * `applyVerifiedBadgeToListings` (mockApi/properties.js) does two things on earn:
 *   1. flips `ownerVerified` on every non-archived listing the user owns —
 *      lighting up the +250 ranking boost and the buyer-facing Verified badge;
 *   2. the FIRST time only, grants a free 7-day Featured slot on the newest
 *      *approved* listing (`featuredReason: 'first-verify'`).
 *
 * Both are asserted on the persisted store rather than through the UI. The badge
 * and the boost are read by ranking code and by buyers on other pages, so
 * checking a pill on the owner's own screen would prove the label rendered, not
 * that the reward was actually granted.
 *
 * The one-shot guard is the sharp part: the perk is keyed on
 * `puneNestFirstFeaturePerk:<mobile>` precisely so re-verifying cannot farm free
 * Featured slots, and nothing tested that. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OWNER = { name: 'Verify Owner', mobile: '9700000077', email: '', role: 'owner', joinedAt: Date.now() };

const dISO = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

/* Shaped like the "Post a property" flow persists. Two approved listings of
   different ages plus one still pending, so the spec can prove the perk picks
   the NEWEST APPROVED one rather than simply the first in the array. */
const listing = (over) => ({
  bhk: '2 BHK', bhkNum: 2, bath: 2, locality: 'Baner', localitySlug: 'baner',
  loc: 'Baner, Pune', society: '', deal: 'buy', owner: OWNER.name, ownerMobile: OWNER.mobile,
  status: 'approved', real: true, featured: false, ownerVerified: false,
  views: 0, enquiries: 0, photoCount: 0, type: 'Flat', area: 1200,
  price: 8000000, priceStr: '₹80 Lacs', amenities: [], gallery: [],
  ...over,
});

const OWNED = [
  listing({ id: 'VB-OLD', title: 'Older Approved Flat', createdAt: dISO(30) }),
  listing({ id: 'VB-NEW', title: 'Newest Approved Flat', createdAt: dISO(2) }),
  listing({ id: 'VB-PEND', title: 'Pending Flat', status: 'pending', createdAt: dISO(1) }),
];

/* The REAL catalogue, appended to rather than replaced. Seeding a bare
   `{ listings: [...] }` white-screens the dashboard: the mock API reads
   societies, users and localities off the same document, so a partial DB throws
   during render and the badge CTA never appears — which cost a diagnosis here
   before the probe showed the CTA rendering fine with no DB seeded at all. */
const SEED_DB = JSON.parse(
  readFileSync(new URL('../../../../frontend/src/data/db.json', import.meta.url), 'utf-8'),
);

async function seedUnverifiedOwner(page) {
  const db = { ...SEED_DB, listings: [...OWNED, ...(SEED_DB.listings || [])] };
  await page.addInitScript(([user, owned, dbJson]) => {
    localStorage.setItem('puneNestUser', JSON.stringify(user));
    localStorage.setItem('puneNestUsers', JSON.stringify([user]));
    /* Seed ONCE. `addInitScript` runs on every navigation, so an unguarded seed
       silently restores the pristine catalogue on the next `goto` — which is
       exactly what the re-verification test navigates to check, and it made the
       granted perk vanish rather than persist. The guard is why mutations made
       by the app survive a reload here. */
    if (!localStorage.getItem('puneNestListings:' + user.mobile)) {
      localStorage.setItem('puneNestListings:' + user.mobile, JSON.stringify(owned));
    }
    if (!localStorage.getItem('puneNestDB_v5')) {
      localStorage.setItem('puneNestDB_v5', dbJson);
    }
    // Deliberately NO puneNestAadhaar key — the badge is what the test earns.
  }, [OWNER, OWNED, JSON.stringify(db)]);
}

const readCatalogue = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('puneNestDB_v5') || '{"listings":[]}').listings
    .filter((l) => String(l.id || '').startsWith('VB-')));

async function earnBadge(page) {
  /* Wait for the CTA rather than clicking straight after `networkidle`. The
     dashboard resolves its owner/seeker shape from several localStorage stores
     after mount, so the card appears a beat after the network settles — clicking
     immediately raced it and timed out on every run. */
  await expect(page.getByTestId('verify-badge-cta')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('verify-badge-btn').click();
  await expect(page.getByRole('dialog', { name: 'Get your Verified badge' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with DigiLocker' }).click();
  // The mock round-trip is on a ~1.7s timer, so wait for the effect, not a delay.
  await expect(page.getByRole('dialog', { name: 'Get your Verified badge' }))
    .toHaveCount(0, { timeout: 15000 });
}

test('earning the badge flips ownerVerified on every listing the owner holds', async ({ page }) => {
  const errors = trackErrors(page);
  await seedUnverifiedOwner(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

  // Control: unverified means unverified. Without this the final assertion could
  // pass against a fixture that was already flipped.
  const before = await readCatalogue(page);
  expect(before).toHaveLength(3);
  expect(before.every((l) => l.ownerVerified === false)).toBe(true);

  await earnBadge(page);

  const after = await readCatalogue(page);
  // ALL of them, including the pending one — the badge is a property of the
  // owner, not of any single listing's moderation state.
  expect(after.every((l) => l.ownerVerified === true)).toBe(true);
  expect(errors).toEqual([]);
});

test('the first verification grants a 7-day Featured slot on the newest APPROVED listing', async ({ page }) => {
  await seedUnverifiedOwner(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await earnBadge(page);

  const after = await readCatalogue(page);
  const byId = Object.fromEntries(after.map((l) => [l.id, l]));

  // Newest *approved* wins — not the newest overall, which is the pending one.
  expect(byId['VB-NEW'].featured).toBe(true);
  expect(byId['VB-NEW'].featuredReason).toBe('first-verify');
  expect(byId['VB-OLD'].featured).toBe(false);
  expect(byId['VB-PEND'].featured).toBe(false);

  // The window has to lapse honestly, or a one-off perk becomes permanent.
  const days = (byId['VB-NEW'].featuredUntil - Date.now()) / 86400000;
  expect(days).toBeGreaterThan(6.5);
  expect(days).toBeLessThan(7.5);
});

test('the free Featured slot is granted once, not once per verification', async ({ page }) => {
  await seedUnverifiedOwner(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await earnBadge(page);

  const first = await readCatalogue(page);
  expect(first.filter((l) => l.featured)).toHaveLength(1);

  /* Re-verify from a clean page load with the badge already held. The perk is
     guarded by `puneNestFirstFeaturePerk:<mobile>`, which is what stops a user
     from farming free Featured slots by verifying repeatedly — an unguarded
     version would silently hand out a paid placement on every round-trip. */
  await page.evaluate((m) => {
    localStorage.removeItem('puneNestAadhaar:' + m);
  }, OWNER.mobile);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await earnBadge(page);

  /* Count featured listings across the whole set, not the first one's window.
     That distinction is the test: with the guard disabled the grant does **not**
     re-extend `VB-NEW` — it picks the next eligible listing and features
     `VB-OLD` as well. An assertion on `VB-NEW.featuredUntil` therefore stays
     green while the exact abuse it claims to prevent is happening, which is how
     this was caught: the guard was disabled on purpose and the test did not go
     red. Counting grants is the only form that can. */
  const second = await readCatalogue(page);
  const featured = second.filter((l) => l.featured);
  expect(featured, 'a second verification must not grant another Featured slot').toHaveLength(1);
  expect(featured[0].id).toBe('VB-NEW');
});
