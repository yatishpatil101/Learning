import { test, expect } from '@playwright/test';
import { openFlatmateFilters } from '../../../helpers/app.js';

/* Host tiers + backfill extended to the ROOMS flow. A room carries the same
   verificationTier / seats / review signals as a group: an Ops-verified owner room
   shows "Owner-verified", a sitting-tenant room shows "Pending Ops review" until Ops
   approves the uploaded agreement (then "Tenant-verified"), seats can be
   reopened/closed by the owner, and the "Verified only" filter surfaces owner rooms
   and Ops-approved tenant rooms. Rooms are seeded directly (the create path is the
   multi-step list-property wizard, covered elsewhere). */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9812345678';

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

// Seed once (mutations like the seat stepper must survive re-navigation).
function seed(mobile, rooms, reviews) {
  return (args) => {
    const [m, rs, rv] = args;
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Room Host', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    /* Answer the cookie banner. It is `fixed` at the bottom of the viewport with its own stacking
       context, so it sits over whatever the page has down there — here, the owner's seat stepper.
       The stepper became reachable-then-not once its writes went through the API: each click is a
       round trip now, so the card re-renders and settles under the banner instead of being clicked
       before anything moves. Dismissing consent is what a returning user's browser looks like
       anyway, and it stops this spec from measuring the banner's z-index. */
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: false, marketing: false, version: 1, ts: Date.now() }));
    if (!localStorage.getItem('puneNestRoomListings')) localStorage.setItem('puneNestRoomListings', JSON.stringify(rs));
    if (rv && !localStorage.getItem('puneNestFlatmateReviews')) localStorage.setItem('puneNestFlatmateReviews', JSON.stringify(rv));
  };
}

async function openRooms(page) {
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
}

test('an Ops-verified owner room shows the Owner-verified badge and a seats chip', async ({ page }) => {
  const rooms = [room('owner-vr', { society: 'Owner Verified Villa', verified: true, verificationTier: 'owner', hostRole: 'owner', seatsTotal: 2, seatsOpen: 2 })];
  await page.addInitScript(seed(MOBILE, rooms, null), [MOBILE, rooms, null]);
  await openRooms(page);
  const card = page.locator('.sf-card', { hasText: 'Owner Verified Villa' }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.getByText(/Owner-verified/i)).toBeVisible();
  await expect(card.getByText(/seats? open/i)).toBeVisible();
});

test('a pending tenant room shows Pending Ops review and withholds the badge', async ({ page }) => {
  const rooms = [room('tenant-pr', { society: 'Tenant Replacement Flat', verificationTier: 'tenant', hostRole: 'tenant', agreementDeclared: true, seatsTotal: 1, seatsOpen: 1 })];
  const reviews = [{ id: 'revRoom1', roomId: 'tenant-pr', kind: 'room', host: 'Room Host', tier: 'tenant', status: 'pending', createdAt: Date.now(), updatedAt: Date.now() }];
  await page.addInitScript(seed(MOBILE, rooms, reviews), [MOBILE, rooms, reviews]);
  await openRooms(page);
  const card = page.locator('.sf-card', { hasText: 'Tenant Replacement Flat' }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  // Badge is earned, not self-claimed: withheld while Ops review is pending.
  await expect(card.getByText(/Pending Ops review/i)).toBeVisible();
  await expect(card.getByText(/Tenant-verified/i)).toHaveCount(0);
});

test('an Ops-approved tenant room shows the Tenant-verified badge', async ({ page }) => {
  const rooms = [room('tenant-ap', { society: 'Approved Tenant Flat', verificationTier: 'tenant', hostRole: 'tenant', agreementDeclared: true, seatsTotal: 1, seatsOpen: 1 })];
  const reviews = [{ id: 'revRoom2', roomId: 'tenant-ap', kind: 'room', host: 'Room Host', tier: 'tenant', status: 'approved', createdAt: Date.now(), updatedAt: Date.now() }];
  await page.addInitScript(seed(MOBILE, rooms, reviews), [MOBILE, rooms, reviews]);
  await openRooms(page);
  const card = page.locator('.sf-card', { hasText: 'Approved Tenant Flat' }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.getByText(/Tenant-verified/i)).toBeVisible();
});

test('the room owner can reopen and close a seat via the backfill stepper', async ({ page }) => {
  const rooms = [room('own-seat', { society: 'Backfill Room', verified: true, verificationTier: 'owner', hostRole: 'owner', seatsTotal: 2, seatsOpen: 1 })];
  await page.addInitScript(seed(MOBILE, rooms, null), [MOBILE, rooms, null]);
  await openRooms(page);
  const card = page.locator('.sf-card', { hasText: 'Backfill Room' }).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.getByText(/1 seat open/i)).toBeVisible();
  await card.locator('.seat-reopen-btn').click();
  await expect(card.getByText(/2 seats open/i)).toBeVisible();
  /* Each step is asserted, rather than clicking twice and checking only the end state.
     The seat count is written through the API now, so a click is a round trip: two clicks fired
     back to back leave Playwright re-running its actionability check against a button React is
     re-rendering underneath it, and the test hangs on a control that is working fine. Asserting the
     intermediate count also says something the end state does not — that the stepper moves one seat
     at a time, not that it lands on zero somehow. */
  await card.locator('.seat-close-btn').click();
  await expect(card.getByText(/1 seat open/i)).toBeVisible();
  await card.locator('.seat-close-btn').click();
  await expect(card.getByText(/Filled/i)).toBeVisible();
});

test('"Verified only" filter keeps an Ops-approved tenant room but drops an unverified one', async ({ page }) => {
  const rooms = [
    room('keep-tenant', { society: 'Kept Tenant Room', verificationTier: 'tenant', hostRole: 'tenant', agreementDeclared: true, seatsTotal: 1, seatsOpen: 1 }),
    room('drop-plain', { society: 'Dropped Plain Room', ownerMobile: '9800000000', owner: 'Someone Else' }),
  ];
  const reviews = [{ id: 'revKeep', roomId: 'keep-tenant', kind: 'room', host: 'Room Host', tier: 'tenant', status: 'approved', createdAt: Date.now(), updatedAt: Date.now() }];
  await page.addInitScript(seed(MOBILE, rooms, reviews), [MOBILE, rooms, reviews]);
  await openRooms(page);
  await expect(page.locator('.sf-card', { hasText: 'Kept Tenant Room' }).first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sf-card', { hasText: 'Dropped Plain Room' }).first()).toBeVisible();
  await openFlatmateFilters(page);
  await page.getByRole('button', { name: /Verified only/i }).first().click();
  await expect(page.locator('.sf-card', { hasText: 'Kept Tenant Room' }).first()).toBeVisible();
  await expect(page.locator('.sf-card', { hasText: 'Dropped Plain Room' })).toHaveCount(0);
});
