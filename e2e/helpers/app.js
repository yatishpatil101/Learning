import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Read seed owners from the application source so fixture identifiers cannot drift.
const PROPERTIES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../frontend/src/data/properties.json', import.meta.url)), 'utf8'),
);
export const seedProperty = (id) => {
  const p = PROPERTIES.find((x) => x.id === id);
  if (!p) throw new Error(`seedProperty: no listing ${id} in properties.json`);
  return p;
};
export const ownerMobileOf = (id) => seedProperty(id).ownerMobile;
// Owner buckets use account ids because masked mobile numbers are not unique.
export const ownerIdOf = (id) => seedProperty(id).ownerId;

export const OWNER = { name: 'Test Owner', mobile: '9800000001', role: 'owner' };
export const SEEKER = { name: 'Test Seeker', mobile: '9800000002', role: 'buyer' };
export const OTHER = { name: 'Other Person', mobile: '9800000003', role: 'owner' };

const KEYS = {
  user: 'draazyUser',
  rooms: 'draazyRoomListings',
  posts: 'draazyFlatmatePosts',
  groups: 'draazyFlatmateGroups',
  reviews: 'draazyFlatmateReviews',
  interests: 'draazyFlatmateInterests',
  // Clear both ledgers so prior specs cannot suppress an expected duplicate response.
  mockInterests: 'dzMockFlatmateInterests',
  saved: 'draazyFlatmateSaved',
};

export const rentListing = (over = {}) => ({
  id: 'L-e2e-1',
  deal: 'rent',
  title: '3 BHK in Test Society',
  locality: 'Baner',
  society: 'Test Society',
  bhk: '3',
  price: 45000,
  status: 'pending',
  statusClass: 'pill-pending',
  ownerMobile: OWNER.mobile,
  image: '',
  real: true,
  createdAt: new Date().toISOString(),
  ...over,
});

// The data URI avoids empty-image warnings and network requests in console-clean fixtures.
const BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Detail-page fixtures need fields omitted from the minimal dashboard listing.
export const propertyListing = (over = {}) => ({
  id: 'P-e2e-1',
  deal: 'rent',
  title: '2 BHK in Test Society',
  type: 'Apartment',
  bhk: '2 BHK',
  bhkNum: 2,
  locality: 'Baner',
  localitySlug: 'baner',
  society: 'Test Society',
  area: 950,
  price: 32000,
  status: 'approved',
  owner: OWNER.name,
  ownerId: 'U-e2e-owner',
  ownerMobile: OWNER.mobile,
  ownerVerified: true,
  ownershipVerified: true,
  furnishing: 'semi',
  construction: 'ready',
  rera: false,
  featured: false,
  amenities: [],
  docsCount: 3,
  flagReason: '',
  views: 10,
  enquiries: 0,
  image: BLANK_IMG,
  gallery: [BLANK_IMG],
  lat: 18.5590,
  lng: 73.7868,
  desc: 'E2E fixture listing.',
  createdAt: new Date().toISOString(),
  ...over,
});

// Seed every synchronous browser-store dependency before first render.
export async function seed(page, {
  user = null, listings = [], rooms = [], posts = [], groups = [], aadhaar = false,
  contactsUsed = null, referralStats = null, plan = null, referredBy = null,
} = {}) {
  await page.addInitScript(([k, data]) => {
    // `addInitScript` runs per navigation; this marker preserves state created during the test.
    if (sessionStorage.getItem('__e2eSeeded')) return;
    sessionStorage.setItem('__e2eSeeded', '1');

    // Remove stale state so each fixture begins isolated.
    Object.values(k).forEach((key) => localStorage.removeItem(key));
    Object.keys(localStorage)
      .filter((key) => key.startsWith('draazyListings:') || key.startsWith('draazyAadhaar:')
        || key.startsWith('dzContactsUsed:') || key.startsWith('dzReferralStats:')
        || key.startsWith('dzReferredBy:') || key.startsWith('dzPlan:'))
      .forEach((key) => localStorage.removeItem(key));

    if (data.user) {
      localStorage.setItem(k.user, JSON.stringify(data.user));
      localStorage.setItem('draazyListings:' + data.user.mobile, JSON.stringify(data.listings));
      if (data.aadhaar) {
        localStorage.setItem('draazyAadhaar:' + data.user.mobile, JSON.stringify({
          verified: true, source: 'digilocker', at: Date.now(),
        }));
      }
      if (data.contactsUsed != null) localStorage.setItem('dzContactsUsed:' + data.user.mobile, JSON.stringify(data.contactsUsed));
      if (data.referralStats) localStorage.setItem('dzReferralStats:' + data.user.mobile, JSON.stringify(data.referralStats));
      if (data.plan) localStorage.setItem('dzPlan:' + data.user.mobile, JSON.stringify(data.plan));
      if (data.referredBy) localStorage.setItem('dzReferredBy:' + data.user.mobile, JSON.stringify(data.referredBy));
    }
    if (data.rooms.length) localStorage.setItem(k.rooms, JSON.stringify(data.rooms));
    if (data.posts.length) localStorage.setItem(k.posts, JSON.stringify(data.posts));
    if (data.groups.length) localStorage.setItem(k.groups, JSON.stringify(data.groups));
  }, [KEYS, { user, listings, rooms, posts, groups, aadhaar, contactsUsed, referralStats, plan, referredBy }]);
}

// Wait for the app signal because network-idle can precede lazy-route evaluation.
export const appReady = (page) => page.waitForFunction(
  () => document.documentElement.dataset.dzBoot === 'ready',
  null,
  { timeout: 30_000 },
);

export const readStore = (page, key) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
export const readContactsUsed = (page, mobile) => readStore(page, 'dzContactsUsed:' + mobile);

// Wait for rendered content because network-idle can precede lazy-route mounting.
export async function open(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
}

export async function openFlatmates(page, query = '') {
  await open(page, '/flatmates' + query);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible();
}

// Scope choices to the dialog because board cards duplicate their accessible names.
const chooser = (page) => page.getByRole('dialog', { name: /What do you want to post/ });
const whoChooser = (page) => page.getByRole('dialog', { name: /Who's looking/ });

// A cold lazy route can accept a click before React attaches its handler, so click and assertion
// retry as a unit; `isVisible()` reads false one frame after a success and re-clicks under the overlay.
async function openSheet(page) {
  const post = page.getByRole('button', { name: /^Post( Property)?$/ }).first();
  await expect(async () => {
    await post.click();
    await expect(chooser(page)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
}

export async function postHavingPlace(page) {
  await openSheet(page);
  await chooser(page).getByRole('button', { name: /A room in my place/i }).click();
}

export async function postAsSolo(page) {
  await openSheet(page);
  await chooser(page).getByRole('button', { name: /I'm looking for a place/i }).click();
  await whoChooser(page).getByRole('button', { name: /Just me/i }).click();
}

export async function postAsGroup(page) {
  await openSheet(page);
  await chooser(page).getByRole('button', { name: /I'm looking for a place/i }).click();
  await whoChooser(page).getByRole('button', { name: /We're already a group/i }).click();
}

export const FLATMATE_STORES = {
  posts: 'draazyFlatmatePosts',
  groups: 'draazyFlatmateGroups',
  rooms: 'draazyRoomListings',
};

// Reload after storage approval and drop `post`, which is an open-form instruction rather than view state.
export async function approveFlatmates(page, ...kinds) {
  // The modal detaching confirms the asynchronous create finished before the store is approved.
  await page.locator('.sf-modal').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  const keys = (kinds.length ? kinds : Object.keys(FLATMATE_STORES)).map((k) => FLATMATE_STORES[k]);
  await page.evaluate((ks) => {
    ks.forEach((key) => {
      const rows = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(rows) || !rows.length) return;
      rows.forEach((r) => { r.modStatus = 'approved'; });
      localStorage.setItem(key, JSON.stringify(rows));
    });
  }, keys);
  const url = new URL(page.url());
  url.searchParams.delete('post');
  await page.goto(url.toString());
  await page.locator('.sf-card').first().waitFor({ timeout: 10_000 }).catch(() => {});
}

// Address-less groups sort into Team up although creation returns to Move in now.
export async function switchToTeamUp(page) {
  await page.getByRole('button', { name: /Team up/ }).first().click();
  await page.waitForTimeout(300);
}

// Filter controls mount only after this toggle opens the collapsed grid.
export async function openFlatmateFilters(page) {
  const toggle = page.getByRole('button', { name: 'Filters', exact: true });
  await toggle.waitFor({ timeout: 10_000 });
  // Deep links can open the grid, so toggling only when it remains collapsed preserves it.
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

// Property details omit an `h1`, so wait for their last-mounted owner contact control.
export async function openProperty(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Request number/i }).first()).toBeVisible({ timeout: 30_000 });
}

export const cardIds = (page) =>
  page.locator('[data-sf-id]').evaluateAll((els) => els.map((e) => e.dataset.sfId));

// The upper thumb is index one; dispatch `change` because `input` alone does not commit filtering.
export async function setBudget(page, value) {
  await page.evaluate((v) => {
    const sliders = document.querySelectorAll('.rng input[type="range"]');
    if (sliders.length < 2) throw new Error(`budget slider not found (got ${sliders.length} range inputs)`);
    const slider = sliders[1];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(slider, String(v));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  // The list memo is non-retrying, so wait for the committed filter to settle.
  await page.waitForTimeout(400);
}
