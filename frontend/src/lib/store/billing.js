import { myMobile } from '../contact.js';
import { rawDb } from '../mockApi.js';
import { get, set } from './internals.js';
import { getListings } from './listings.js';

/* =========================================================================
   Platform fees (single source of truth = back-office Settings → Charges)
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
export const fee = (key) => '₹' + Number(getFees()[key] || 0).toLocaleString('en-IN');

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
   ========================================================================= */
export const PLAN_LISTING_LIMITS = { free: 1, 'owner-free': 1, owner2: 2, owner5: 5 };
export const listingLimit = () => PLAN_LISTING_LIMITS[getPlan().id] || 1;
/* Active (non-deleted / non-archived) property listings owned by the user. */
export const activeListingCount = () =>
  getListings().filter((l) => !l.flatmate && !/deleted|archived/i.test(String(l.status || ''))).length;
/* True when the user still has a free/paid slot for a NEW listing. */
export const canPostListing = () => activeListingCount() < listingLimit();

/* =========================================================================
   Service orders (Move-in Pack / marketplace)
   ========================================================================= */
const serviceOrderKey = () => 'pnServiceOrders:' + (myMobile() || 'anon');
export const getServiceOrders = () => get(serviceOrderKey(), []);
export const addServiceOrder = (o) => {
  const arr = getServiceOrders();
  const rec = Object.assign({ id: 'so' + Date.now(), status: 'placed', at: Date.now() }, o || {});
  arr.unshift(rec);
  set(serviceOrderKey(), arr);
  return rec;
};

