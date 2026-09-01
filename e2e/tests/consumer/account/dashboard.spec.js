// @ts-check
import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const OWNER = { name: 'Owner Test', mobile: '9800000001', email: '', role: 'owner', joinedAt: Date.now() };
const SEEKER = { name: 'Seeker Test', mobile: '9700000002', email: '', role: 'user', joinedAt: Date.now() };

const LISTING = {
  id: 'L-TEST-1', title: 'Test 2 BHK, Baner', locality: 'Baner', deal: 'rent',
  price: 25000, status: 'approved', real: true, ownerMobile: '9800000001', views: 7,
};

async function login(page, user, { listings, savedSearches, aadhaar } = {}) {
  await page.addInitScript(({ u, l, ss, aad }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    if (l) localStorage.setItem('puneNestListings:' + u.mobile, JSON.stringify(l));
    if (ss) localStorage.setItem('pnSavedSearches:' + u.mobile, JSON.stringify(ss));
    if (aad) localStorage.setItem('puneNestAadhaar:' + u.mobile, JSON.stringify({ verified: true, at: Date.now() }));
  }, { u: user, l: listings || null, ss: savedSearches || null, aad: aadhaar || false });
}

/* Put a listing where the owner dashboard actually looks for one.

   `login({ listings })` writes `puneNestListings:<mobile>`, which is where the dashboard read from
   until "My Listings" was repointed onto `propertyService.myListings`. The mock provider behind that
   seam resolves the *catalogue* (`puneNestDB_v5`) and keeps only rows marked `real`, so the
   per-owner key is no longer read by anything and these two tests were seeding into a drawer nobody
   opens: the owner had no inventory, the management tabs stayed gated, and the Overview stats had
   nothing to total.

   It has to run after boot. The app seeds `puneNestDB_v5` itself on first load, so an
   `addInitScript` write is overwritten before the page settles — hence the `pnBoot` wait rather
   than another init script. */
async function publishToCatalogue(page, listing, mobile) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.pnBoot === 'ready', null, { timeout: 30000 });
  await page.evaluate(({ l, m }) => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing');
    const db = JSON.parse(raw);
    db.listings = [{ ...l, ownerMobile: m, real: true }, ...(db.listings || []).filter((p) => p.id !== l.id)];
    localStorage.setItem(KEY, JSON.stringify(db));
  }, { l: listing, m: mobile });
}

test.describe('Consumer Dashboard', () => {
  test('an owner with NO inventory does not see management tabs (gating by posting)', async ({ page }) => {
    await login(page, OWNER); // role owner but zero listings/rooms/managed
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /^Requests$/ })).toHaveCount(0);
    // Finances is role-aware now (Rent Wallet for non-owners) so it's always present.
    await expect(page.getByRole('button', { name: /Finances/ }).first()).toBeVisible();
  });

  test('posting a listing unlocks the owner management tabs', async ({ page }) => {
    await login(page, OWNER, { listings: [LISTING] });
    await publishToCatalogue(page, LISTING, OWNER.mobile);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /^Requests$/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Finances/ }).first()).toBeVisible();
    // The alias lands on the unified My Properties surface (single list — no sub-nav).
    await page.goto(`${BASE}/dashboard#listings`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /My properties/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Your property, working for you').first()).toBeVisible({ timeout: 10000 });
  });

  test('a seeker never sees owner management tabs', async ({ page }) => {
    await login(page, SEEKER);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /^Requests$/ })).toHaveCount(0);
    // Finances is no longer owner-only — a seeker sees it as their Rent Wallet.
    await expect(page.getByRole('button', { name: /^Finances/ }).first()).toBeVisible();
  });

  test('Overview shows real data, not fabricated stats', async ({ page }) => {
    await login(page, OWNER, { listings: [LISTING] });
    await publishToCatalogue(page, LISTING, OWNER.mobile);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Total Views')).toBeVisible();
    // The old hardcoded numbers must be gone.
    await expect(page.getByText('1,284')).toHaveCount(0);
    await expect(page.getByText('Times Shortlisted')).toHaveCount(0);
  });

  test('seeker Overview does not show a fake rental / rent-due banner', async ({ page }) => {
    await login(page, SEEKER);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByText('2 BHK Flat, Wakad')).toHaveCount(0);
    await expect(page.getByText('Rent due soon')).toHaveCount(0);
  });

  test('deep-links resolve via #hash and ?tab=', async ({ page }) => {
    await login(page, SEEKER);
    await page.goto(`${BASE}/dashboard#profile`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Notification Preferences' })).toBeVisible();

    await page.goto(`${BASE}/dashboard?tab=alerts`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /Alerts/ }).first()).toBeVisible();
  });

  test('every visible tab renders without console errors (owner)', async ({ page }) => {
    const errors = trackErrors(page);
    await login(page, OWNER, { listings: [LISTING] });
    // New consolidated tab ids + every legacy alias hash (back-compat deep-links).
    const tabs = [
      'overview', 'properties', 'activity', 'leads', 'finances', 'documents', 'visits', 'messages', 'profile',
      'owner-hub', 'listings', 'enquiries', 'saved', 'recent', 'alerts', 'billing',
    ];
    for (const t of tabs) {
      await page.goto(`${BASE}/dashboard#${t}`, { waitUntil: 'networkidle' });
      // A tab that never rendered raises no console errors either, so the sweep needs each panel to
      // have actually painted before it can claim the panel is clean.
      await expect(page.locator('main')).not.toBeEmpty();
    }
    expect(errors, 'console errors across tabs').toEqual([]);
  });

  test('Overview surfaces real alert matches that deep-link to filtered listings', async ({ page }) => {
    // 28 approved rentals seed the catalog, incl. Hinjawadi — this alert must match.
    await login(page, SEEKER, {
      savedSearches: [{ id: 'ss-hinj', deal: 'rent', localities: ['hinjawadi'], bhk: [], alerts: true, label: 'Rent in Hinjawadi' }],
    });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    const card = page.getByTestId('alert-matches');
    await expect(card).toBeVisible();
    await expect(card.getByText('Rent in Hinjawadi')).toBeVisible();
    await expect(card.getByText(/\d+ new/).first()).toBeVisible();
    // The match row deep-links to the actual filtered results, not a generic page.
    await card.getByText('Rent in Hinjawadi').click();
    await expect(page).toHaveURL(/\/listings\?.*deal=rent.*q=hinjawadi/);
  });

  test('Overview hides the alert-matches card when a search has zero live matches', async ({ page }) => {
    await login(page, SEEKER, {
      savedSearches: [{ id: 'ss-none', deal: 'rent', localities: ['no-such-locality'], bhk: [], alerts: true, label: 'Nowhere' }],
    });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('alert-matches')).toHaveCount(0);
  });

  test('profile-completion meter shows for an incomplete profile with a next step', async ({ page }) => {
    await login(page, SEEKER); // name only; no email/city; unverified
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    const meter = page.getByTestId('profile-meter');
    await expect(meter).toBeVisible();
    await expect(meter.getByText('Add your email address').first()).toBeVisible();
    // Next-step CTA jumps to the Profile tab.
    await meter.getByRole('button', { name: /Add your email address/ }).click();
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  });

  test('profile-completion meter disappears when the profile is fully complete', async ({ page }) => {
    const FULL = { ...SEEKER, email: 'seeker@example.com', city: 'Pune' };
    await login(page, FULL, { aadhaar: true });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('profile-meter')).toHaveCount(0);
  });

  test('a returning seeker can resume their most recent search from the Overview', async ({ page }) => {
    const RS = [
      { label: 'Rent · 2 BHK · Baner', url: '/listings?deal=rent&loc=Baner&bhk=2', at: Date.now() - 3600000 },
      { label: 'Buy · 3 BHK · Wakad', url: '/listings?deal=buy&loc=Wakad&bhk=3', at: Date.now() - 86400000 },
    ];
    await page.addInitScript(({ u, rs }) => {
      localStorage.setItem('puneNestUser', JSON.stringify(u));
      localStorage.setItem('puneNestUsers', JSON.stringify([u]));
      localStorage.setItem('pnRecentSearches:' + u.mobile, JSON.stringify(rs));
    }, { u: SEEKER, rs: RS });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

    const hero = page.getByTestId('resume-search');
    await expect(hero).toBeVisible();
    await expect(hero.getByText('Rent · 2 BHK · Baner')).toBeVisible();
    // Primary CTA deep-links to the actual filtered search.
    await hero.getByRole('link', { name: /Resume search/ }).click();
    await expect(page).toHaveURL(/\/listings\?.*loc=baner/i);
  });

  test('the resume-search hero never appears without a real recent search, nor for owners', async ({ page }) => {
    // Seeker with no search history → no hero (honest, not fabricated).
    await login(page, SEEKER);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('resume-search')).toHaveCount(0);

    // Owner with a search history → still no hero (owners have a different flow).
    await page.addInitScript(({ u, rs }) => {
      localStorage.setItem('puneNestUser', JSON.stringify(u));
      localStorage.setItem('puneNestUsers', JSON.stringify([u]));
      localStorage.setItem('puneNestListings:' + u.mobile, JSON.stringify([{ id: 'L1', title: '2 BHK', status: 'approved', real: true, ownerMobile: u.mobile, views: 5 }]));
      localStorage.setItem('pnRecentSearches:' + u.mobile, JSON.stringify(rs));
    }, { u: OWNER, rs: [{ label: 'Rent · Baner', url: '/listings?loc=Baner', at: Date.now() }] });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('resume-search')).toHaveCount(0);
  });

  test('mobile section switcher opens a sheet of all sections and navigates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, SEEKER);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

    // Collapsed: one switcher row (not a horizontal pill strip), showing the
    // current section. The sheet is closed, so section buttons aren't in the DOM yet.
    const switcher = page.getByRole('button', { name: /Dashboard section/i });
    await expect(switcher).toBeVisible();
    const sheet = page.getByRole('dialog', { name: /Choose dashboard section/i });
    await expect(sheet).toHaveCount(0);

    // Open the sheet — every section is now listed at once (no horizontal scroll).
    await switcher.click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Overview$/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /Profile & Settings/ })).toBeVisible();

    // Selecting a section navigates and closes the sheet.
    await sheet.getByRole('button', { name: /Profile & Settings/ }).click();
    await expect(page.getByRole('heading', { name: 'Notification Preferences' })).toBeVisible();
    await expect(sheet).toHaveCount(0);
    await expect(switcher).toContainText('Profile & Settings');
  });
});
