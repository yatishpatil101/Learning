import { readUser } from '../auth.js';
import { myMobile } from '../contact.js';
import { mutateDb, rawDb } from '../mockApi.js';
import { get, set } from './internals.js';

/* =========================================================================
   Referrals + non-monetary rewards

   Two earn-instead-of-pay tracks sit on top of the referral program:
     · Seeker — every friend who joins credits +15 free owner contacts, so a
       seeker who has burned their 15 free contacts can refer instead of buying.
     · Owner  — every referred owner who posts their first property unlocks one
       extra free listing slot, so an owner at their post limit can refer
       instead of upgrading.
   Everything ELSE (boosts, featured placement, priority support, unlimited
   contacts) stays strictly behind the paid plans — referrals only ever move
   these two specific quotas.

   ── Q17 / D191 ─────────────────────────────────────────────────────────────
   The counters below are LOCAL and grant quota locally, which is exactly what
   D191 records: one person with several SIMs can move them. The rule the
   platform actually runs on now lives on the server — a referral credits the
   referrer when the referee's FIRST listing passes ownership verification —
   because clearing the document gate is the only qualifying action a browser
   cannot fake. See ReferralQualification on the backend.

   These counters are NOT the server's ledger and must not be treated as one.
   They stay until there is a `referral` domain in services/providers/{mock,http}
   and a product decision mapping the server's ₹ credit onto the client's quota
   (free listing slots / free contacts) — two different currencies today, which
   is why the seam cannot simply be pointed at the existing endpoints. Removing
   them first would delete a shipped perk with nothing to restore it from.
   Do not add new ways to increment them.

   UPDATE (D233): the first half of that precondition is now met and the second
   is not, so the paragraph above needs correcting rather than deleting. There
   IS a `referral` domain in services/providers/{mock,http} — it has had an http
   provider since D184 (the fraud desk) and now has a mock one too, carrying the
   consumer half. What has NOT happened is the currency decision, and that is
   why these counters are still here and still local.

   What moved out of this file: `referralCode` is no longer the app's answer to
   "what is my code". `Refer.jsx` reads it from `GET /me/referrals`; this
   function survives only as the mock provider's implementation of that call,
   so the mock build keeps the string it has always shown. The code minted here
   was never resolvable by `POST /referrals/redeem` — the server's is
   `PUNE-AB12` from `referral_codes` (V23) — so every link this product has
   produced pointed at a scheme that could not recognise it.

   What did NOT move: everything below `referralListingsTarget`. The rewards.
   ========================================================================= */
export const referralListingsTarget = 3;
export const referralJoinsTarget = 1;
export const referralContactsPerReward = 15;
/* One referred owner who posts a property = one extra free listing slot. */
export const referralListingSlotsPerReward = 1;

/* Admin ▸ Settings ▸ Feature flags ▸ Monetization ▸ "Referral rewards".
   Off = referrals stop moving quotas and paid plans become the only way past
   one. Matches AppFlagsContext semantics (`!== false`, so a missing key is on).
   Read straight from the DB because the store layer is plain modules, not React. */
export const referralRewardsEnabled = () => {
  try { return rawDb()?.settings?.flags?.referralRewards !== false; } catch { return true; }
};
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
/* `listed` and `joined` had ungated setters here (addReferralListing /
   addReferralJoin) that nothing ever called — two exported ways to mint quota,
   reachable from any module, guarding nothing. Removed rather than left as dead
   code: under Q17 the qualifying action is server-side, so any future increment
   has to arrive through the services seam, and an exported local incrementer is
   the first thing someone reaches for instead. The counters themselves are
   still written by claimReferralCredits(), which drains the deduped credit
   ledger below \u2014 one place, with a dedupe key, rather than two open setters. */
export const referralFreeAgreements = () => Math.floor((getReferralStats().listed || 0) / referralListingsTarget);
export const referralContactsEarned = () => Math.floor((getReferralStats().joined || 0) / referralJoinsTarget) * referralContactsPerReward;
/* Extra free listing slots earned by referring owners who went on to post.
   Consumed by billing.listingLimit(). */
export const referralBonusListings = () => (referralRewardsEnabled() ? (getReferralStats().listed || 0) * referralListingSlotsPerReward : 0);
/* Extra free owner contacts earned by referring seekers who joined.
   Consumed by contactQuota.contactAllowance(). */
export const referralBonusContacts = () => (referralRewardsEnabled() ? referralContactsEarned() : 0);

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

/* =========================================================================
   Referral credit ledger — the bridge that was missing.

   A referred user's action (joining, posting their first listing) writes an
   UNCLAIMED credit into the shared mock DB, addressed to the referrer by code
   and/or mobile. The referrer picks it up with claimReferralCredits() on their
   next session, which bumps their own pnReferralStats counters and therefore
   their free-contact / free-listing allowance.

   A real backend would credit the referrer directly; this ledger is the honest
   prototype equivalent and keeps the grant logic in exactly one place.
   ========================================================================= */
const CREDIT_KINDS = ['join', 'listing'];

/** Queue a reward for whoever owns `code` (and/or `mobile`). Idempotent per dedupeKey. */
export const creditReferrer = ({ code, mobile, kind, dedupeKey } = {}) => {
  const c = String(code || '').trim().toUpperCase();
  const m = String(mobile || '').replace(/\D/g, '');
  if (!c && !m) return null;
  if (!CREDIT_KINDS.includes(kind)) return null;
  const key = String(dedupeKey || `${kind}:${c || m}:${myMobile() || 'anon'}`);
  return mutateDb((db) => {
    if (!Array.isArray(db.referralCredits)) db.referralCredits = [];
    if (db.referralCredits.some((x) => x.dedupeKey === key)) return null;
    const rec = { id: 'rc' + Date.now() + Math.random().toString(36).slice(2, 7), code: c, mobile: m, kind, dedupeKey: key, at: Date.now(), claimed: false };
    db.referralCredits.push(rec);
    return rec;
  });
};

/** Pull every unclaimed credit addressed to the signed-in user into their stats. */
export const claimReferralCredits = () => {
  const mine = myMobile();
  if (!mine) return 0;
  const myCode = referralCode();
  let joins = 0;
  let listings = 0;
  mutateDb((db) => {
    (db.referralCredits || []).forEach((r) => {
      if (r.claimed) return;
      if (r.code !== myCode && r.mobile !== mine) return;
      r.claimed = true;
      r.claimedAt = Date.now();
      if (r.kind === 'join') joins++;
      else if (r.kind === 'listing') listings++;
    });
  });
  if (!joins && !listings) return 0;
  const s = getReferralStats();
  s.joined = (s.joined || 0) + joins;
  s.listed = (s.listed || 0) + listings;
  set(statsKey(), s);
  return joins + listings;
};

/** How many credits are waiting for the signed-in user (read-only peek). */
export const pendingReferralCredits = () => {
  const mine = myMobile();
  if (!mine) return 0;
  const myCode = referralCode();
  try {
    return (rawDb().referralCredits || []).filter((r) => !r.claimed && (r.code === myCode || r.mobile === mine)).length;
  } catch { return 0; }
};

/* Convenience hooks for the two moments that earn a reward. Both are deduped
   per referred user, so a referrer earns at most one join credit and one
   listing credit from any single friend. */
export const creditReferrerForJoin = () =>
  creditReferrer({ code: getReferredBy(), kind: 'join', dedupeKey: 'join:' + (myMobile() || 'anon') });
export const creditReferrerForListing = () =>
  creditReferrer({ code: getReferredBy(), kind: 'listing', dedupeKey: 'listing:' + (myMobile() || 'anon') });



