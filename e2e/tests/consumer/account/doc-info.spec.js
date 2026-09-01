import { test, expect, devices } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OWNER = { name: 'Owner Test', mobile: '9800000001', email: '', role: 'owner', joinedAt: Date.now() };
const LISTING = { id: 'L-TEST-1', title: 'Test 2 BHK, Baner', locality: 'Baner', deal: 'rent', price: 25000, status: 'approved', real: true, ownerMobile: '9800000001', views: 7 };

async function login(page, user, listings) {
  await page.addInitScript(({ u, l }) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    if (l) localStorage.setItem('puneNestListings:' + u.mobile, JSON.stringify(l));
    // The global cookie-consent banner is a late-mounting role="dialog" that covers most of a
    // phone viewport. Its arrival reflows the vault, and `Tip` closes on scroll — so on the touch
    // path the tip could be dismissed the instant it opened. Seed consent so it never appears.
    // (Same pattern as deals-offers.spec.js / support-tickets.spec.js.)
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  }, { u: user, l: listings || null });
}

/**
 * Wait until the page has stopped growing and stopped scrolling.
 *
 * The vault fills asynchronously — its documents come from `documentService`, so "Document Vault"
 * is on screen before the tiles have their data — and a late reflow moves the info dot. `Tip` closes
 * on any scroll (by design: a tooltip must not float away from its anchor), so if the interaction is
 * what finally scrolls the dot into view, the tip is dismissed the instant it opens. Settling first,
 * and centring the dot instantly so the click/tap has nothing left to scroll, is what makes these
 * two tests assert the tooltip rather than the race.
 */
async function settle(page) {
  await page.waitForFunction(() => {
    const now = document.body.scrollHeight + ':' + Math.round(window.scrollY);
    const stable = window.__pnSettle === now;
    window.__pnSettle = now;
    return stable;
  }, null, { polling: 150, timeout: 10_000 });
}

/** Park the dot in the middle of the viewport — clear of the fixed header and bottom nav. */
async function centre(page, dot) {
  await settle(page);
  await dot.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await settle(page);
}

/* Make the seeded user an owner as far as the seam is concerned.

   The Documents vault renders its owner "Property docs" context off the listings the property
   service returns, and the mock behind that seam reads the catalogue (`puneNestDB_v5`), not the
   `puneNestListings:<mobile>` key `login()` writes. Without this the owner had no property, the
   vault fell back to the personal identity view, and the info dots and Rent Agreement panel these
   tests hover and click were never rendered.

   After boot: the app seeds the catalogue itself on first load and would overwrite an init script. */
async function ownListing(page, listing) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.pnBoot === 'ready', null, { timeout: 30000 });
  await page.evaluate((l) => {
    const KEY = 'puneNestDB_v5';
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error('mock store missing');
    const db = JSON.parse(raw);
    db.listings = [{ ...l, real: true }, ...(db.listings || []).filter((p) => p.id !== l.id)];
    localStorage.setItem(KEY, JSON.stringify(db));
  }, listing);
}

test('desktop: hovering a document info dot reveals its significance tip', async ({ page }) => {
  const errors = trackErrors(page);

  await page.setViewportSize({ width: 1280, height: 1400 });
  await login(page, OWNER, [LISTING]);
  await ownListing(page, LISTING);
  await page.goto(`${BASE}/dashboard#documents`, { waitUntil: 'networkidle' });
  await page.getByText('Document Vault').waitFor({ timeout: 15000 });

  // Title & Ownership is open by default; hover the first info dot.
  const dot = page.getByRole('button', { name: /What is Sale Deed/i }).first();
  await centre(page, dot);
  await dot.hover();
  const tip = page.locator('.pn-tip[role="tooltip"]');
  await expect(tip).toBeVisible({ timeout: 3000 });
  await expect(tip).toContainText(/ownership was transferred/i);
  // aria wiring while open
  await expect(page.locator('[data-tip][aria-describedby]').first()).toBeVisible();

  await page.mouse.move(2, 2);
  await expect(tip).toBeHidden({ timeout: 3000 });

  const relevant = errors.filter((e) => !/favicon|leaflet|googleapis|gstatic|maps|ERR_|net::|Failed to load resource|DevTools/i.test(e));
  expect(relevant, relevant.join('\n')).toHaveLength(0);
});

test('mobile/touch: tapping a document info dot opens then dismisses the tip', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], hasTouch: true });
  const page = await ctx.newPage();
  await login(page, OWNER, [LISTING]);
  await ownListing(page, LISTING);
  await page.goto(`${BASE}/dashboard#documents`, { waitUntil: 'networkidle' });
  await page.getByText('Document Vault').waitFor({ timeout: 15000 });

  const dot = page.getByRole('button', { name: /What is Sale Deed/i }).first();
  await centre(page, dot);
  await dot.tap();
  const tip = page.locator('.pn-tip[role="tooltip"]');
  await expect(tip).toBeVisible({ timeout: 3000 });
  await expect(tip).toContainText(/Sale Deed/i);

  // Outside tap dismisses.
  await page.mouse.click(5, 5);
  await expect(tip).toBeHidden({ timeout: 3000 });
  await ctx.close();
});

test('owner Documents vault carries a property-scoped Rent Agreement panel', async ({ page }) => {
  // Rent agreements are property-specific, so they live in the owner "Property docs"
  // vault (scoped to the selected property), NOT the tenant "Personal" identity vault.
  await login(page, OWNER, [LISTING]);
  await ownListing(page, LISTING);
  await page.goto(`${BASE}/dashboard#documents`, { waitUntil: 'networkidle' });
  await page.getByText('Document Vault').waitFor({ timeout: 15000 });

  // Owner context is the default for an owner. The Rent Agreement panel must be present
  // here and describe itself as per-property.
  const panel = page.getByRole('button', { name: /Rent Agreement/i }).first();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/for this property|Registered agreement for/i);
  await panel.click();
  await expect(page.getByText(/No rent agreement on record for this property|Riya/i)).toBeVisible();
});

test('a tenant sees their Rent Agreement in a property-scoped My Tenancy vault, not Personal', async ({ page }) => {
  const TENANT = { name: 'Yatish', mobile: '9800000002', email: '', role: 'buyer', joinedAt: Date.now() };
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    localStorage.setItem('pnTenancies:' + u.mobile, JSON.stringify([{
      id: 'ten-1', tenantMobile: u.mobile, propId: 'T-RENT-1', title: 'Rented 2 BHK, Baner',
      address: 'B-1204, Rohan Leher, Baner', ownerName: 'Rahul Deshmukh', rent: 28000, status: 'active',
    }]));
    localStorage.setItem('puneNestRentAgreement:' + u.mobile, JSON.stringify([{
      id: 'ra-1', propId: 'T-RENT-1', landlord: 'Rahul Deshmukh', tenant: 'Riya Tenant',
      status: 'registered', at: Date.now(),
    }]));
  }, TENANT);
  /* The panel labels itself with the *property's* title, and `TenancyDto` does not carry one —
     `toRentalCard` takes it from the matching listing and falls back to a generic "Rented home"
     when the caller has none. The seed above put a `title` on the tenancy blob, which nothing reads
     any more, so the panel was correctly describing a flat it could not name. Publish the property
     the tenancy points at so there is something to name it after. */
  await ownListing(page, {
    id: 'T-RENT-1', title: 'Rented 2 BHK, Baner', address: 'B-1204, Rohan Leher, Baner',
    locality: 'Baner', bhk: '2 BHK', deal: 'rent', price: 28000, status: 'approved',
    ownerMobile: '9800000003',
  });
  await page.goto(`${BASE}/dashboard#documents`, { waitUntil: 'networkidle' });
  await page.getByText('Document Vault').waitFor({ timeout: 15000 });

  // A non-owner tenant lands on "My Tenancy" by default; the agreement is scoped to their flat.
  await expect(page.getByRole('button', { name: /My Tenancy/i })).toBeVisible();
  const panel = page.getByRole('button', { name: /Rent Agreement/i }).first();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Registered agreement for Rented 2 BHK, Baner');
  await expect(page.getByText('Riya Tenant')).toBeVisible();

  // The old Personal-context "Rent Agreements" panel must be gone.
  await page.getByRole('button', { name: /^Personal$/ }).click();
  await expect(page.getByRole('button', { name: /Rent Agreements/i })).toHaveCount(0);
});
