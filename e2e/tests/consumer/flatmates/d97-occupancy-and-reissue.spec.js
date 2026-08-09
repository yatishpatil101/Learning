import { test, expect } from '@playwright/test';

/* Regression coverage for two of the three D97 flatmate bugs.

   D97(c) — occupancyOf collapsed a stored 'filling' to occupied. At rest a room's
   occupancy enum is empty|occupied and 'filling' is a *derived* state, but a room
   record that already carries occupancy:'filling' (legacy/seed data, or a value that
   round-trips through the provider VM which preserves it verbatim) was swept into
   OCCUPIED by a single `!== EMPTY` guard. RoomCard hides the whole vacant-home
   disclosure strip when a room reads OCCUPIED, so a filling home became *invisible* —
   the seeker never saw "N people have already taken rooms". After the fix the stored
   'filling' is re-derived and the disclosure strip shows the filling note.

   D97(a) — the flatmate board's "reissue the joint agreement" CTA links to
   /services/rent-agreement?flat=<listing-id>&reissue=1, but the wizard only ever read
   ?listing=, so that CTA opened a blank form. The auto-fill effect now accepts `flat`
   as an alias for `listing` and, when reissue=1, prefills the property and confirms
   with a toast.

   D97(b) (addFlatmateRequest dropping the room `share` intent) is a data-layer fix
   with no rendered consumer today — the dashboard host inbox does not display a
   request's share, only the mock provider VM (requestVm.share) reads it back — so it
   is not UI-observable and is covered by code review + the provider VM, not here. */

const BASE = 'http://localhost:5173';
const MOBILE = '9812345678';

// ---- D97(c) ----------------------------------------------------------------

function room(id, extra = {}) {
  return {
    id, type: 'flatmate', society: 'Skyline Heights', owner: 'Room Host', ownerMobile: MOBILE,
    flatType: '2 BHK', roomType: 'Private room', furnishing: 'semi',
    locality: 'Baner', localities: ['Baner'], budget: 15000, deposit: 30000,
    moveIn: 'now', gender: 'any', food: 'any', tags: [], note: '',
    img: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=80',
    verified: false, time: 'Just now', status: 'pending', createdAt: Date.now(), ...extra,
  };
}

function seedRooms(mobile, rooms) {
  return (args) => {
    const [m, rs] = args;
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Room Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: false, marketing: false, version: 1, ts: Date.now() }));
    localStorage.setItem('puneNestRoomListings', JSON.stringify(rs));
  };
}

test('a room stored as occupancy:filling discloses the filling note instead of hiding it as occupied', async ({ page }) => {
  // occupancy:'filling' is the collapsed-at-rest value the fix must re-derive; `occupants`
  // drives the flat ledger (decorateRooms recomputes flatCommitted from it) so the room reads
  // as FILLING with a real count. Pre-fix, occupancyOf swept the stored 'filling' straight to
  // OCCUPIED and RoomCard hid the whole disclosure strip.
  const rooms = [room('filling-room', { society: 'Half Full House', occupancy: 'filling', occupants: 2 })];
  await page.addInitScript(seedRooms(MOBILE, rooms), [MOBILE, rooms]);
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  const card = page.locator('.sf-card', { hasText: 'Half Full House' }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  // fillingHomeNote_other for count=2. Pre-fix this strip was hidden (room read OCCUPIED).
  await expect(card.getByText(/2 people have taken rooms so far/i)).toBeVisible();
});

// ---- D97(a) ----------------------------------------------------------------

function seedListing(mobile, listing) {
  return (args) => {
    const [m, l] = args;
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Room Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: false, marketing: false, version: 1, ts: Date.now() }));
    localStorage.setItem('puneNestListings:' + m, JSON.stringify([l]));
  };
}

test('the reissue CTA (?flat=<id>&reissue=1) prefills the property and confirms with a toast', async ({ page }) => {
  const listing = { id: 'reissue-flat', title: 'My 2BHK, Baner', loc: 'Baner, Pune', price: 25000, deposit: 50000, furnishing: 'furnished', deal: 'rent', status: 'verified' };
  await page.addInitScript(seedListing(MOBILE, listing), [MOBILE, listing]);
  await page.goto(`${BASE}/services/rent-agreement?flat=reissue-flat&reissue=1`);

  // The reissue toast only fires when `flat` resolves a listing AND reissue=1 —
  // it proves both the param-name alias and the reissue flag were read. (.first() because
  // React StrictMode double-invokes the effect in dev, firing the toast twice.)
  await expect(page.getByRole('alert').filter({ hasText: /Reissuing the agreement/i }).first()).toBeVisible({ timeout: 5000 });
  // Property prefilled from the listing (society derived from loc, ", Pune" stripped).
  await expect(page.getByPlaceholder(/Skyline Heights/i)).toHaveValue('Baner');
});
