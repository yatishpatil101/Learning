import { myMobile } from '../contact.js';
import { rawDb } from '../mockApi.js';
import { get, set } from './internals.js';
import { referralBonusListings } from './referrals.js';

/* =========================================================================
   Platform fees — the mock path's copy, and only the mock path's

   `getFees()` is now called by three mock providers and by nothing else. Every screen that used to
   read it goes through `usePricing()` instead, which asks `GET /pricing` and falls back to
   `PRICING_DEFAULTS` in `services/settingsService.js`. That is why `fee()` is gone from here: it
   was the formatter six components imported directly, and importing a *formatter* was how they
   ended up importing a *price*, from a browser-local document no signed-out visitor has.

   `FEE_DEFAULTS` must stay in step with `PRICING_DEFAULTS` and with the server's `PlatformSettings`
   defaults. Three copies is one more than anybody wants, but each is the last resort of a different
   process and none can read the others. Keeping them equal is what stops the mock and live modes
   quoting different prices for the same plan — which is precisely what happened while nothing read
   the server at all, and it went unnoticed until something finally did.
   ========================================================================= */
const FEE_DEFAULTS = { ownerPlanYearly: 999, ownerProYearly: 2499, rentAgreementPlatform: 500, seekerPlusTopup: 199, featuredListing: 999, gstPercent: 18, rentPayPercent: 2 };
export const getFees = () => {
  let f = FEE_DEFAULTS;
  // Single source of truth = the back-office admin DB (Settings → Fees), read via the
  // same accessor the admin writes through so it always tracks the current DB key.
  try {
    const db = rawDb();
    if (db && db.settings && db.settings.fees) return Object.assign({}, f, db.settings.fees);
  } catch { /* fall through to legacy keys */ }
  // Fallback: HTML prototype's admin DB key (older static app).
  let db = null;
  try { db = JSON.parse(localStorage.getItem('puneNestAdminDB_v7')); } catch { db = null; }
  if (db && db.settings && db.settings.fees) f = Object.assign({}, f, db.settings.fees);
  return f;
};

/* =========================================================================
   Owner boosts + subscription plans
   ========================================================================= */
const boostKey = () => 'pnBoosts:' + (myMobile() || 'anon');
export const isBoosted = (id) => (get(boostKey(), {})[id] || 0) > Date.now();
export const boostListing = (id, days) => {
  const b = get(boostKey(), {});
  b[id] = Date.now() + (days || 7) * 864e5;
  return set(boostKey(), b);
};
const planKey = () => 'pnPlan:' + (myMobile() || 'anon');
export const getPlan = () => get(planKey(), { id: 'free', name: 'Free' });
export const setPlan = (p) => set(planKey(), p);
/* Paid owner plans unlock self-serve promotion (featuring a listing). Free plans
   (free / owner-free) must upgrade first — see MyListingsPanel's Feature action. */
export const PAID_OWNER_PLANS = ['owner2', 'owner5'];
export const isPaidOwnerPlan = () => PAID_OWNER_PLANS.includes(getPlan().id);

/* =========================================================================
   Freemium listing quota — the free plan includes ONE live listing; paid plans
   raise the ceiling. Editing an existing listing never consumes quota; only a
   genuinely new property does (see the paywall in ListProperty).

   Owners can also EARN slots instead of paying: every owner they refer who goes
   on to post a property unlocks one extra free slot (referralBonusListings).
   This is the only plan benefit referrals move — boosts, featuring and priority
   support stay strictly paid.
   ========================================================================= */
export const PLAN_LISTING_LIMITS = { free: 1, 'owner-free': 1, owner2: 2, owner5: 5 };
export const planListingLimit = () => PLAN_LISTING_LIMITS[getPlan().id] || 1;

/**
 * Live-listing ceiling = what the plan allows + what referrals earned.
 *
 * **Mock-only now.** The app asks `GET /me/entitlements` (`lib/data/listingQuota.js`); this is the
 * arithmetic the *mock* entitlements provider answers with, so the two modes agree on shape.
 *
 * It used to be the app's answer, taking an optional `planLimit` from `PlanContext` and adding the
 * referral bonus on top. That was double-counting against the API: the server's
 * `listings.allowance` already contains the bonus, so a caller who added `referralBonusListings()`
 * to it granted every earned slot twice. The seam is gone rather than corrected — a ceiling a
 * browser can compute is a ceiling a browser can raise.
 */
export const listingLimit = () => planListingLimit() + referralBonusListings();

/* `pnServiceOrders:<mobile>` used to be written here by `addServiceOrder`, from the plan checkout
   and the move-in-pack booking. Nothing ever read it: `getServiceOrders()` had no callers and
   `BillingPanel` renders a static constant. Both purchases are recorded where they belong now — a
   subscription by `POST /me/subscription`, a pack booking by the packers-desk ticket that carries
   its accepted total — and `GET /me/service-orders` exists for orders against the marketplace
   catalogue, which neither of those is. (D236) */

