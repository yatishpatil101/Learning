import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* Shared fixtures for the Flatmates e2e suite.

   PuneNest is a localStorage-backed prototype: there is no server state to set
   up, so a test "logs in" and "owns a listing" by writing the same keys the app
   writes. Seeding happens in an init script so it lands BEFORE React boots —
   writing after navigation would race the first render. */

/* The seed listing several contact/deal specs drive, read from the same file the
   app reads rather than copied into each spec.

   This exists because the copy drifted: P5000's ownerMobile changed to
   9999047855, but five specs still carried the old 9530047855. They kept
   "passing" their setup and then asserted against `puneNestContactReq:<old>` —
   a key nothing ever writes — so the failure surfaced as a confusing empty
   array rather than "your constant is stale". Deriving it means the next data
   change can't silently rot the suite. */
const PROPERTIES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../frontend/src/data/properties.json', import.meta.url)), 'utf8'),
);
export const seedProperty = (id) => {
  const p = PROPERTIES.find((x) => x.id === id);
  if (!p) throw new Error(`seedProperty: no listing ${id} in properties.json`);
  return p;
};
/** Owner mobile for a seed listing — the suffix of `puneNestContactReq:` etc. */
export const ownerMobileOf = (id) => seedProperty(id).ownerMobile;
/** Owner *account id* for a seed listing — the suffix of the owner-scoped deal/visit buckets
 *  (`puneNestDeals:`, `pnOffers:`, `puneNestPropVisitReqs:`). Those moved off the mobile in D30,
 *  because a masked number strips to a short string several owners share. */
export const ownerIdOf = (id) => seedProperty(id).ownerId;

export const OWNER = { name: 'Test Owner', mobile: '9800000001', role: 'owner' };
export const SEEKER = { name: 'Test Seeker', mobile: '9800000002', role: 'buyer' };
export const OTHER = { name: 'Other Person', mobile: '9800000003', role: 'owner' };
/* Back-office session shape written by staffLoginUser() — `moduleAccess: ['*']`
   is what ModuleRoute checks before rendering an admin page. */
export const ADMIN = { name: 'Administrator', mobile: '9000000000', role: 'admin', team: null, teams: [], roleId: null, moduleAccess: ['*'] };

const KEYS = {
  user: 'puneNestUser',
  users: 'puneNestUsers',
  rooms: 'puneNestRoomListings',
  posts: 'puneNestFlatmatePosts',
  groups: 'puneNestFlatmateGroups',
  reviews: 'puneNestFlatmateReviews',
  interests: 'puneNestFlatmateInterests',
  // The mock provider's own interest ledger — its stand-in for the API's unique index (D181).
  // Distinct from `interests`, which is only what this browser remembers asking. Both are cleared
  // so a spec that asks twice gets the real 409 rather than a leftover from the previous test.
  mockInterests: 'pnMockFlatmateInterests',
  saved: 'puneNestFlatmateSaved',
};

/** A rent listing in the shape `getListings()` returns. */
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

/* A 1x1 transparent GIF. Real listings carry a photo URL; an empty `src` makes
   React warn and the browser re-request the page, which pollutes any spec that
   asserts on a clean console. A data URI keeps the fixture offline. */
const BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * A listing in the fuller shape the property DETAIL page needs.
 *
 * `rentListing()` is deliberately minimal — enough for the dashboard's listing
 * cards. The detail page derives copy from fields like `type` and `bhkNum` and
 * will throw on a card-shaped record, so specs that navigate to /property/:id
 * must seed this instead.
 */
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

/**
 * Seed localStorage before the app boots.
 * Pass `user` to sign in, `listings` for owner-side property state, `rooms` /
 * `posts` / `groups` for flatmate supply, and `aadhaar` to grant the KYC badge.
 *
 * Commercial state (`contactsUsed`, `referralStats`, `plan`, `referredBy`) lives
 * in separate mobile-keyed stores, so it is seeded here too — the quota gates
 * read it synchronously during the first render.
 */
export async function seed(page, {
  user = null, listings = [], rooms = [], posts = [], groups = [], aadhaar = false,
  contactsUsed = null, referralStats = null, plan = null, referredBy = null,
} = {}) {
  await page.addInitScript(([k, data]) => {
    /* addInitScript runs on EVERY navigation, so this must be idempotent: a
       second run would wipe whatever the test just did (publish a listing, split
       a flat) the moment the page navigates. The marker makes seeding a
       once-per-test operation. */
    if (sessionStorage.getItem('__e2eSeeded')) return;
    sessionStorage.setItem('__e2eSeeded', '1');

    // A previous spec's state must never leak into this one.
    Object.values(k).forEach((key) => localStorage.removeItem(key));
    Object.keys(localStorage)
      .filter((key) => key.startsWith('puneNestListings:') || key.startsWith('puneNestAadhaar:')
        || key.startsWith('pnContactsUsed:') || key.startsWith('pnReferralStats:')
        || key.startsWith('pnReferredBy:') || key.startsWith('pnPlan:'))
      .forEach((key) => localStorage.removeItem(key));

    if (data.user) {
      localStorage.setItem(k.user, JSON.stringify(data.user));
      localStorage.setItem(k.users, JSON.stringify([data.user]));
      localStorage.setItem('puneNestListings:' + data.user.mobile, JSON.stringify(data.listings));
      if (data.aadhaar) {
        localStorage.setItem('puneNestAadhaar:' + data.user.mobile, JSON.stringify({
          verified: true, source: 'digilocker', at: Date.now(),
        }));
      }
      if (data.contactsUsed != null) localStorage.setItem('pnContactsUsed:' + data.user.mobile, JSON.stringify(data.contactsUsed));
      if (data.referralStats) localStorage.setItem('pnReferralStats:' + data.user.mobile, JSON.stringify(data.referralStats));
      if (data.plan) localStorage.setItem('pnPlan:' + data.user.mobile, JSON.stringify(data.plan));
      if (data.referredBy) localStorage.setItem('pnReferredBy:' + data.user.mobile, JSON.stringify(data.referredBy));
    }
    if (data.rooms.length) localStorage.setItem(k.rooms, JSON.stringify(data.rooms));
    if (data.posts.length) localStorage.setItem(k.posts, JSON.stringify(data.posts));
    if (data.groups.length) localStorage.setItem(k.groups, JSON.stringify(data.groups));
  }, [KEYS, { user, listings, rooms, posts, groups, aadhaar, contactsUsed, referralStats, plan, referredBy }]);
}

/**
 * Wait until the app has finished booting.
 *
 * Use this before ANY `page.evaluate` that reads or writes the mock store directly.
 *
 * `waitUntil: 'networkidle'` does not mean the app is ready, and on this app it is not
 * even close. Vite downloads the whole module graph and only then evaluates it, so the
 * last response lands about a second before `main.jsx` runs — `networkidle` resolves
 * against an empty document.
 *
 * `data-pn-boot="ready"` is set on the last statement of `main.jsx` before
 * `createRoot(...).render(...)`, so it marks the point where the module graph has finished
 * evaluating. It used to promise more — that a browser database had finished seeding — and
 * specs once waited on `localStorage['puneNestDB_v5']` instead, which was worse: the dev-only
 * disk hydration wrote that key *before* the one-shot migrations ran, so it could be present
 * and stale. The store and that race are both gone (P5c). The flag stays because the
 * `networkidle` problem above did not go with them.
 *
 * @param {import('@playwright/test').Page} page
 */
export const appReady = (page) => page.waitForFunction(
  () => document.documentElement.dataset.pnBoot === 'ready',
  null,
  { timeout: 30_000 },
);

/** Read a localStorage key back out as JSON (assertions on persisted state). */
export const readStore = (page, key) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);

/* `publishListing`, `approveListing` and `setFlags` stood here, and `readRooms`,
   `readReviews` and `readReferralStats` with them. Every one of them reached into
   `puneNestDB_v5` — the mock marketplace store — to fabricate a listing, moderate it, patch
   `settings.flags`, or read back what the browser had written. That store is gone (P5c), so
   the first `JSON.parse(localStorage.getItem(...))` in each would now yield `null` and throw
   on the property access one line later. None of them had a caller left: a spec that needs a
   published, approved listing POSTs `/me/listings` as a real owner and PATCHes
   `/properties/{id}/status` as a real admin — see the local `publishListing` in
   `consumer/list-property/live-consumer-fixes.spec.js`, which is deliberately its own
   function rather than an import, because it has to speak the wire vocabulary that sits
   below `propertyMapper`. Flags are server state now and belong to the admin settings API. */

/** Free owner contacts the signed-in seeker has spent. */
export const readContactsUsed = (page, mobile) => readStore(page, 'pnContactsUsed:' + mobile);
/* `readReferralCredits` was here. The browser-side referral credit ledger it read is gone (D234):
   the grant now happens on the server, derived from the qualified referrals that justify it, so
   there is no local queue of unclaimed rewards left to inspect. */

/**
 * Open a page and wait for the lazy route to actually render. Every consumer
 * route mounts behind Suspense, so `networkidle` fires while a spinner is still
 * on screen — specs must wait for real content instead.
 */
export async function open(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
}

/** The Flatmates page, with the lazy chunk resolved. */
export async function openFlatmates(page, query = '') {
  await open(page, '/flatmates' + query);
  await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible();
}

/* ── Posting flow ──────────────────────────────────────────────────────────
   The three per-tab post buttons ("Create a group", "List your room", "Post your
   request") were replaced by ONE `Post` button that opens a chooser: first "do
   you have a place?", then, for people who don't, "just me or a group?".

   The rationale (see useFlatmateDiscovery.jsx) is that a poster shouldn't have
   to guess which tab to stand on before they can post. These helpers encode that
   two-step walk once — seven specs drove the old buttons directly, and inlining
   the new flow seven times would just recreate the same coupling.

   Every choice is scoped to `.sf-modal`: the seeker cards *behind* the overlay
   carry their own "Just me" segment control, so an unscoped match resolves to
   four elements. */
const chooser = (page) => page.locator('.sf-modal');

/** Open the post chooser and pick "I have a place".
 *  Note this LEAVES /flatmates — it routes to /list-property?flatmate=1. */
export async function postHavingPlace(page) {
  await page.getByRole('button', { name: /^Post$/ }).first().click();
  await chooser(page).getByRole('button', { name: /I have a place/i }).click();
}

/** Open the post chooser and pick "still looking" → "just me" → the seeker form. */
export async function postAsSolo(page) {
  await page.getByRole('button', { name: /^Post$/ }).first().click();
  await chooser(page).getByRole('button', { name: /I'm still looking for a place/i }).click();
  await chooser(page).getByRole('button', { name: /Just me/i }).click();
}

/** Open the post chooser and pick "still looking" → "we're a group" → group form. */
export async function postAsGroup(page) {
  await page.getByRole('button', { name: /^Post$/ }).first().click();
  await chooser(page).getByRole('button', { name: /I'm still looking for a place/i }).click();
  await chooser(page).getByRole('button', { name: /We're already a group/i }).click();
}

/* ── Flatmate moderation (D72) ─────────────────────────────────────────────
   Every post, room and group now starts at `modStatus: 'pending'` and the board
   filters on a whitelist, so anything a spec creates through the UI is invisible
   until a moderator approves it. That is the feature, not a bug — but it is not
   what most of these specs are about, and rewriting them to assert an absence
   would delete the behaviour they were written to protect.

   So a spec that needs its own creation on the board stands in for the moderator,
   in one named line. Specs that test the gate itself live in
   `moderate-before-public.spec.js` and deliberately do NOT call this. */
export const FLATMATE_STORES = {
  posts: 'puneNestFlatmatePosts',
  groups: 'puneNestFlatmateGroups',
  rooms: 'puneNestRoomListings',
};

/**
 * Approve every row in the named flatmate stores (all three by default), then
 * reload so the board re-reads them.
 *
 * The reload is part of the helper rather than the caller's job because the
 * approval happens in storage, behind the running page — without it the assertion
 * that follows would race a feed the page has no reason to re-fetch, and would
 * pass or fail on timing rather than on moderation.
 *
 * `?post=1` is dropped on the way: it is an "open the post form" instruction, not
 * view state, and replaying it after a post exists reopens the form (or trips the
 * duplicate guard) over the board the caller is about to assert on.
 */
export async function approveFlatmates(page, ...kinds) {
  /* The create that precedes this call is async (`await refresh()` before the
     modal closes), so under parallel load the write can still be in flight. Wait
     for the form to go away first — approving a store mid-write would silently
     miss the new row and leave the modal covering the tab strip afterwards. */
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

/* Switch to the Team up feed.
   A group you just created has no address yet, so it sorts into Team up — but
   creation returns you to the default Move in now tab, where the card genuinely
   is not. Specs that assert on a freshly created group need this hop; without it
   they fail looking for a card that exists one tab over. */
export async function switchToTeamUp(page) {
  await page.getByRole('button', { name: /Team up/ }).first().click();
  await page.waitForTimeout(300);
}

/* Open the advanced filter grid on the Flatmates page.
   The grid used to be always-on; it now folds behind a `Filters` toggle that is
   collapsed unless a filter is already active, because on a 1440x820 laptop the
   permanent block pushed the first result card to y=881 (see FilterBar.jsx).
   Controls inside it — "Verified only", lifestyle tags, attached-bath — are not
   in the DOM until this runs, so a spec that clicks one directly times out
   waiting for a button the page is not currently offering. */
export async function openFlatmateFilters(page) {
  const toggle = page.getByRole('button', { name: 'Filters', exact: true });
  await toggle.waitFor({ timeout: 10_000 });
  // Idempotent: a deep link with filters already applied opens the grid itself, and
  // clicking then would close it.
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/**
 * A property detail page. It renders no `h1`, so `open()`'s heading wait never
 * settles here — wait on the owner contact box instead, which is the last thing
 * the page mounts.
 */
export async function openProperty(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Request number/i }).first()).toBeVisible({ timeout: 30_000 });
}

/** Card ids currently rendered, e.g. ['r:rm1', 's:s2', 'g:g1']. */
export const cardIds = (page) =>
  page.locator('[data-sf-id]').evaluateAll((els) => els.map((e) => e.dataset.sfId));

/** Drive the budget range input (React needs a native setter + input event). */
export async function setBudget(page, value) {
  await page.evaluate((v) => {
    const slider = document.querySelector('input[type="range"]');
    if (!slider) throw new Error('budget slider not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(slider, String(v));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  // Let the filter memos settle before asserting on the list.
  await page.waitForTimeout(400);
}
