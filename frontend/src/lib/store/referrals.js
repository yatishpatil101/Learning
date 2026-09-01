import { readUser } from '../auth.js';
import { myMobile } from '../contact.js';
import { rawDb } from '../mockApi.js';
import { get, set } from './internals.js';

/* =========================================================================
   Referrals + non-monetary rewards — what is LEFT of them in the browser.

   Two earn-instead-of-pay tracks sit on top of the referral program:
     · Seeker — every friend who joins credits +15 free owner contacts, so a
       seeker who has burned their 15 free contacts can refer instead of buying.
     · Owner  — referring owners who go on to post unlocks extra free listing
       slots and free rent agreements, so an owner at their post limit can refer
       instead of upgrading.
   Everything ELSE (boosts, featured placement, priority support, unlimited
   contacts) stays strictly behind the paid plans — referrals only ever move
   these quotas.

   ── D234: the ledger is gone ───────────────────────────────────────────────
   This file used to contain the grant itself. A referred user's action wrote an
   unclaimed credit into the shared mock DB; the referrer drained it with
   claimReferralCredits() on their next session, which bumped local counters
   that fed their free-contact and free-listing allowance. It was described here
   as "the honest prototype equivalent" of a backend, and it was honest about
   being local — but local is the problem, not a caveat to it: the page that
   advertised the reward was also the page that granted it, one person with
   several SIMs could mint quota at will, clearing site data destroyed perks
   somebody had genuinely earned, and a referral the fraud desk clawed back went
   on paying out forever because nothing on the server could reach the counter.

   The grant now lives where the referrals do. `GET /me/entitlements` derives
   the contact bonus, the listing bonus and the free-agreement count from the
   qualified referrals that justify them, on every request — so a clawback takes
   its rewards back with it and no counter has to be un-incremented by hand.
   Deleted with it: creditReferrer, creditReferrerForJoin,
   creditReferrerForListing, claimReferralCredits, pendingReferralCredits and
   addReferralInvite. Do not reintroduce a local way to earn.

   ── What is still here, and why ────────────────────────────────────────────
   `referralCode` survives as the MOCK provider's answer to "what is my code" —
   `Refer.jsx` reads the real one from `GET /me/referrals`. The code minted here
   was never resolvable by `POST /referrals/redeem` (the server's is `PUNE-AB12`
   from `referral_codes`, V23), so every link this product ever produced pointed
   at a scheme that could not recognise it.

   `referralLink` left with the page that used it — it is now
   `services/referralService.js`'s `referralLink(code)`, with the code REQUIRED.
   Here it was `referralLink(code = referralCode())`, so any caller who omitted
   the argument built a link around the browser-minted code: the failure above,
   reachable by forgetting a parameter. It is a pure string builder either way,
   so nothing was gained by it sitting beside the counters.

   `setReferredBy` is still here, but its caller moved. `Signup.jsx` used to call
   it directly, above the seam, so a live build wrote a localStorage key nothing
   on that build reads. It is now called by `providers/mock/referralProvider.js`
   inside `redeemReferral`, which is the mock's whole answer to attribution — one
   writer per build instead of one unconditional one.

   `getReferralStats` and the three derivations below it are the mock build's
   server-side state, read only by the mock providers and seeded directly by the
   e2e harness. Nothing in the application imports them, and nothing writes
   them. That is the difference between a fixture and a ledger.
   ========================================================================= */
import { referralListingsTarget, referralContactsPerReward } from '../referralConfig.js';
export { referralListingsTarget, referralContactsPerReward };
const referralJoinsTarget = 1;
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
/* `listed` and `joined` had ungated setters here (addReferralListing /
   addReferralJoin) that nothing ever called — two exported ways to mint quota,
   reachable from any module, guarding nothing. `invited` had one more,
   addReferralInvite(), which the Refer page called every time somebody pressed
   Share; the server counts invitations from redeemed codes, so the local number
   was a count of button presses wearing the name of a count of people.

   Nothing writes these counters any more. They are read by the mock providers
   below and seeded directly by the e2e harness, which is the only honest thing
   a browser-side referral tally can be: a fixture. */
export const referralFreeAgreements = () => Math.floor((getReferralStats().listed || 0) / referralListingsTarget);
export const referralContactsEarned = () => Math.floor((getReferralStats().joined || 0) / referralJoinsTarget) * referralContactsPerReward;
/* Extra free listing slots earned by referring owners who went on to post.
   Consumed by billing.listingLimit(). */
export const referralBonusListings = () => (referralRewardsEnabled() ? (getReferralStats().listed || 0) * referralListingSlotsPerReward : 0);
/* Extra free owner contacts earned by referring seekers who joined.
   Consumed by contactQuota.contactAllowance(). */
export const referralBonusContacts = () => (referralRewardsEnabled() ? referralContactsEarned() : 0);

// Record who referred a newly-signed-up user (honest, backend-ready primitive).
// Does NOT credit the referrer's counters — cross-device attribution needs a real backend.
// Called by `providers/mock/referralProvider.js` only; `Signup.jsx` reaches it through
// `redeemReferral()` so that the live build talks to the server and this build talks to here,
// rather than every build doing both.
const referredByKey = () => 'pnReferredBy:' + (myMobile() || 'anon');
export const setReferredBy = (code) => {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  return set(referredByKey(), c);
};
export const getReferredBy = () => get(referredByKey(), null);


