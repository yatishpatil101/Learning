import { readUser } from '../auth.js';
import { digits, myMobile } from '../contact.js';
import { get, set } from './internals.js';

/* =========================================================================
   Rent payments, ledger, mandate — the MOCK build's write path

   What used to live here as well: `rentFeeRate`, `calcRentFee`, `addRentLedger`,
   `addPlatformRentFee` and `getPlatformRentFees`. They were the other four fifths of a rent
   payment, and they are the server's now (D232/D236). Two of them were doing something worse than
   duplicating it: `calcRentFee` let the browser decide what the platform charged — halve
   `rentPayPercent` in devtools and the convenience fee halves with it — and `addPlatformRentFee`
   booked the platform's own revenue into the payer's localStorage, which is the one ledger the
   payer must not be able to write. `quoteRentFee` in `providers/http/rentMapper.js` is what a
   client is allowed to do with a fee: quote it, for display, before the server states it.
   ========================================================================= */
const rentPaymentKey = () => 'pnRentPayments:' + (myMobile() || 'anon');
export const getRentPayments = () => get(rentPaymentKey(), []);
export const addRentPayment = (o) => {
  const arr = getRentPayments();
  const rec = Object.assign({ id: 'rp' + Date.now(), status: 'paid', at: Date.now() }, o || {});
  arr.unshift(rec);
  set(rentPaymentKey(), arr);
  return rec;
};
const rentLedgerKey = (ownerMobile) => 'pnRentLedger:' + (digits(ownerMobile) || 'anon');
export const getRentLedger = (ownerMobile) => get(rentLedgerKey(ownerMobile), []);
export const getRentMandate = () => get('pnRentMandate:' + (myMobile() || 'anon'), null);
export const setRentMandate = (m) => set('pnRentMandate:' + (myMobile() || 'anon'), m ? Object.assign({ at: Date.now() }, m) : null);

/* =========================================================================
   Owner payout account (mock KYC)
   ========================================================================= */
const payoutKey = (mobile) => 'pnPayout:' + (digits(mobile || myMobile()) || 'anon');
export const getPayoutAccount = (mobile) => get(payoutKey(mobile), null);
export const savePayoutAccount = (acc, mobile) => set(payoutKey(mobile), Object.assign({ verified: true, at: Date.now() }, acc || {}));
export const hasPayoutAccount = (mobile) => {
  const a = getPayoutAccount(mobile);
  return !!(a && (a.vpa || a.accountNumber));
};

/* =========================================================================
   Tenancies (a tenant's finalised rentals; written cross-actor on finalize)
   ========================================================================= */
const tenancyKey = (mobile) => 'pnTenancies:' + (digits(mobile) || 'anon');
export const getTenanciesFor = (mobile) => get(tenancyKey(mobile), []);
export const getTenancies = () => getTenanciesFor(myMobile());
export const addTenancy = (mobile, t) => {
  const key = tenancyKey(mobile);
  const arr = get(key, []);
  t = t || {};
  const pid = t.propId || '';
  const own = digits(t.ownerMobile || '');
  const existing = arr.filter((x) => x.propId === pid && digits(x.ownerMobile) === own)[0];
  if (existing) {
    Object.keys(t).forEach((k) => { existing[k] = t[k]; });
  } else {
    arr.unshift(Object.assign({ id: 'tn' + Date.now(), at: Date.now(), status: 'active' }, t));
  }
  set(key, arr);
  return arr;
};

/* =========================================================================
   Rent agreements done via PuneNest (per current user)
   ========================================================================= */
const raKey = () => {
  const u = readUser();
  return 'puneNestRentAgreement:' + ((u && u.mobile) || 'anon');
};
export const getRentAgreements = () => get(raKey(), []);
export const addRentAgreement = (a) => {
  const arr = getRentAgreements();
  arr.unshift(a);
  return set(raKey(), arr);
};

/* =========================================================================
   Verified tenant / buyer profile (two-sided trust)
   ========================================================================= */
const tenantKey = () => 'pnTenantProfile:' + (myMobile() || 'anon');
export const getTenantProfile = () => get(tenantKey(), null);
export const tenantScore = (p) => {
  p = p || getTenantProfile() || {};
  let s = 0;
  if (p.idVerified) s += 30;
  if (p.employment) s += 20;
  if (p.income) s += 15;
  if (p.priorLandlord) s += 15;
  if (p.about) s += 10;
  if (p.occupants) s += 10;
  return Math.min(100, s);
};
export const saveTenantProfile = (o) => {
  const prev = getTenantProfile() || {};
  const p = Object.assign({}, prev, o, { updatedAt: Date.now() });
  p.score = tenantScore(p);
  return set(tenantKey(), p);
};
export const isTenantVerified = () => {
  const p = getTenantProfile();
  return !!(p && p.idVerified);
};
export const getTenantProfileFor = (mobile) => {
  try {
    return JSON.parse(localStorage.getItem('pnTenantProfile:' + (digits(mobile) || 'anon')));
  } catch {
    return null;
  }
};
/* SEAM NOTE — this is the MOCK's answer to "is this person a verified tenant". Do not call it
   from a component.

   It used to be called straight from render, and the comment here used to explain why: every
   caller asks about somebody else, inside a list — the tick beside each offer, applicant and
   reviewer — and `GET /tenant-profiles/{mobile}` answers for one person, so routing it through the
   seam would have been one request per row. There was no batch endpoint to restructure into.

   There is now: `POST /tenant-profiles/verified` (D114), reached through
   `rentService.tenantsVerified(mobiles)`, which answers a whole list in one call and returns a Set
   of the numbers that are verified. Components ask that; this function is what the mock provider
   answers it with, and localStorage is legitimately the mock's whole world.

   The fail-closed property survives the move and is still the point: every failure — an unknown
   number here, a rejected request or a masked number live — produces *absence* from the set, and
   absence renders no badge. A verified tenant may lose a tick; an unverified one can never gain
   one.

   Live caveat worth knowing before trusting a live badge: an offer or finalization row carries the
   buyer's mobile MASKED (`98XXXXX210`) until contact is approved (D5), and five digits is not a
   number the server can answer for. Those rows get no badge live, by design. Closing that needs a
   `verified` flag on the party object the wire already embeds — see D114's second option. */
export const isTenantVerifiedFor = (mobile) => {
  const p = getTenantProfileFor(mobile);
  return !!(p && p.idVerified);
};

