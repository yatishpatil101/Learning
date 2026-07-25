import { readUser } from '../auth.js';
import { myMobile } from '../contact.js';
import { get, set } from './internals.js';

/* =========================================================================
   Referrals + non-monetary rewards
   ========================================================================= */
export const referralListingsTarget = 3;
export const referralJoinsTarget = 1;
export const referralContactsPerReward = 15;
export const referralCode = () => {
  const u = readUser();
  const base = u && u.name ? u.name.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4) : 'PUNE';
  const key = 'pnReferralCode:' + (myMobile() || 'anon');
  let c = get(key, null);
  if (!c) {
    c = base + (myMobile() ? myMobile().slice(-4) : Math.floor(1000 + Math.random() * 9000));
    set(key, c);
  }
  return c;
};
const statsKey = () => 'pnReferralStats:' + (myMobile() || 'anon');
export const getReferralStats = () => get(statsKey(), { invited: 0, joined: 0, listed: 0 });
export const addReferralInvite = () => {
  const s = getReferralStats();
  s.invited++;
  return set(statsKey(), s);
};
export const addReferralListing = () => {
  const s = getReferralStats();
  s.listed = (s.listed || 0) + 1;
  return set(statsKey(), s);
};
export const addReferralJoin = () => {
  const s = getReferralStats();
  s.joined = (s.joined || 0) + 1;
  return set(statsKey(), s);
};
export const referralFreeAgreements = () => Math.floor((getReferralStats().listed || 0) / referralListingsTarget);
export const referralContactsEarned = () => Math.floor((getReferralStats().joined || 0) / referralJoinsTarget) * referralContactsPerReward;

// Absolute signup link that carries the referral code so a real backend could
// attribute the join. In the prototype this drives ?ref capture on /signup.
export const referralLink = (code = referralCode()) => {
  const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || 'https://punenest.com';
  return `${origin}/signup?ref=${encodeURIComponent(code)}`;
};
// Record who referred a newly-signed-up user (honest, backend-ready primitive).
// Does NOT credit the referrer's counters — cross-device attribution needs a real backend.
const referredByKey = () => 'pnReferredBy:' + (myMobile() || 'anon');
export const setReferredBy = (code) => {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  return set(referredByKey(), c);
};
export const getReferredBy = () => get(referredByKey(), null);

