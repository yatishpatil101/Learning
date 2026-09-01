/**
 * Mock referral provider — **the consumer half only**.
 *
 * ## Why this file exists at all, given `http/referralProvider.js` says there is no mock provider
 *
 * That statement was true and is now half true, so it is worth being precise rather than quietly
 * contradicting it. `http/referralProvider.js`'s header reads:
 *
 *   > **Live-only, like `ticketProvider`.** `lib/mockApi.js`'s referral store cannot express this
 *   > endpoint's answers: it has a `flagged` status the server does not know, it hands out unmasked
 *   > mobile numbers the server deliberately withholds, and its Approve pays a perk (a listing slot,
 *   > or +15 contacts) where the server pays rupees.
 *
 * Every word of that is about **the fraud desk** — the queue and the three decisions. It is still
 * true of them, and this file does not implement them; they throw below rather than resolving to
 * something plausible-looking.
 *
 * None of it is about the **referrer's own view**. `GET /me/referrals` answers "what is my code, how
 * many people used it, how many were approved". The mock can answer the first two exactly and the
 * third approximately, and there is no vocabulary to invent: a code is a string and a count is a
 * count. Register item 31 makes the same split — the currency question is a decision, the *code* is
 * not, because the server has one and the browser invents a different one and only one of them can
 * be right.
 *
 * ## What the mock's code is, and why it stays wrong on purpose
 *
 * `referralCode()` in `lib/store/referrals.js` mints four letters of the user's name plus the last
 * four digits of their mobile — `RAHU0011`. The server mints `PUNE-AB12`. They do not match and
 * they are not meant to: on a mock build there is no server to agree with, and rewriting the mock
 * to *look* like the server would be the worst of both, a fake that passes for real. The mock's
 * format is left visibly its own so that anyone reading a code can tell which build produced it.
 *
 * ## Rewards are reported as zero, not omitted
 *
 * D31b settled the currency question item 31 left open: the server pays **owner contacts**, which is
 * the same unit the browser was already granting, so there are no longer two currencies to
 * reconcile. What there still is not, on a mock build, is anything to count — the mock has no
 * redemption and no fraud desk, so no referral here has ever been approved. `contactsEarned` and
 * `contactsPending` are therefore honestly `0`, and the quota figures the product actually shows
 * come from `GET /me/entitlements`, which on this build is `providers/mock/entitlementProvider.js`
 * reading the same local counters as before. Reporting zero rather than omitting the fields keeps
 * the shape the same across providers, which is the seam's whole job.
 */
import { delay } from '../../../lib/mockApi/core.js';
import { referralCode, getReferralStats } from '../../../lib/store/referrals.js';

/**
 * `GET /me/referrals` — the referrer's own summary.
 *
 * `invited` is the local share counter, which is what this build has always shown under the copy
 * "You've invited N". Against the server that number means something stricter — people who actually
 * redeemed the code — and the difference is real, not cosmetic. It is left alone here because the
 * mock has no redemption to count, and inventing one would put a number on screen that no action in
 * the mock build can move.
 */
export async function getMyReferralSummary() {
  await delay();
  const stats = getReferralStats();
  return {
    code: referralCode(),
    invited: stats.invited || 0,
    converted: stats.listed || 0,
    contactsEarned: 0,
    contactsPending: 0,
  };
}

/**
 * `POST /referrals/redeem` — a no-op that says so.
 *
 * The mock's attribution primitive is `setReferredBy(code)`, which the sign-up flow already calls
 * and which deliberately does *not* credit anybody: "cross-device attribution needs a real backend",
 * per its own comment. Duplicating that here would give the seam two writers for one fact. So this
 * resolves without doing anything, and the caller treats a mock build as "recorded locally", which
 * is the truth.
 */
export async function redeemReferral() {
  await delay();
  return null;
}

/* ── The fraud desk is deliberately absent ────────────────────────────────────────────────────
   `OpsReferrals` gates on `isHttpDomain('referral')` and renders an explanation when the domain is
   not live, so these are unreachable from the product. They exist as throws rather than as missing
   exports because "listReferralQueue is not a function" names the mechanism and not the reason, and
   the reason is the whole point: the mock store's referral vocabulary disagrees with the server's
   about what a referral *is* (a `flagged` status the server has no concept of, unmasked mobiles it
   withholds, a perk where it pays rupees). See D184. */
const DESK_CLOSED =
  'The referral fraud desk has no mock provider by design (D184): the mock store\'s referral ' +
  'vocabulary disagrees with the server\'s about what a referral is. Enable the `referral` domain ' +
  'in VITE_API_DOMAINS to use it.';

export async function listReferralQueue() { throw new Error(DESK_CLOSED); }
export async function approveReferral() { throw new Error(DESK_CLOSED); }
export async function rejectReferral() { throw new Error(DESK_CLOSED); }
export async function clawbackReferral() { throw new Error(DESK_CLOSED); }
