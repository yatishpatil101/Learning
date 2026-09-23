/**
 * Referral Service — the fraud desk, and the referrer's own view of their scheme.
 *
 * `GET /me/referrals`, `POST /referrals/redeem`, `GET /referrals`,
 * `POST /referrals/{id}/approve|reject|clawback`.
 *
 * ## Two audiences
 *
 * `ReferralsController` states the split: "`GET /me/referrals` and `POST /referrals/redeem` are any
 * authenticated user's; the queue and the three decisions are the fraud desk's."
 *
 * The desk half is **staff-only**, and the difference is one of kind rather than of permission: the
 * desk deals in a status vocabulary the server owns, in mobile numbers the server deliberately
 * withholds, and in an Approve that pays rupees. The consumer half deals in a code and a count.
 *
 * ## The rules that are no longer this layer's business
 *
 * - **Whether a referral may be approved.** The referred party must hold an Aadhaar badge. That is
 *   `ReferralService.approve`, and a refusal arrives as a 409 with the sentence to show. The client
 *   still disables the button, but as a mirror rather than as the rule.
 * - **Which states a decision may be made from.** `pending` and `qualified` may be approved or
 *   rejected; only `rewarded` may be clawed back. Anything else is a 409.
 * - **What the reward is worth.** `rewardAmount`, from platform settings at redeem time.
 * - **How risky a referral looks.** `risk` is computed from the signals server-side. The desk reads
 *   it and filters on it; it does not derive it.
 *
 * ## What no client can do
 *
 * See a referrer's or referee's real phone number. Both are masked on this list, and there is no
 * unmasked single-record read to fall back to — which is why no client-side perk grant keyed on a
 * mobile number is possible.
 */
import { createProvider } from './config.js';

const provider = createProvider('referral');

/**
 * A page of the queue.
 *
 * `status` and `risk` are the server's filters. There is no `flagged` status — the board's
 * **High risk** tab reads the `risk` field instead. The desk pulls a window and groups it in the
 * browser, so the filters here are for a caller that wants one slice; they are not what draws the
 * tabs.
 */
export async function listReferralQueue(params) {
  return (await provider()).listReferralQueue(params);
}

/** Approve — releases the reward. 409s when the referred party is not Aadhaar-verified. */
export async function approveReferral(id) {
  return (await provider()).approveReferral(id);
}

/** Reject — refuses the reward. The reason is best-effort audit context, not a gate. */
export async function rejectReferral(id, reason) {
  return (await provider()).rejectReferral(id, reason);
}

/** Clawback — reverses a released reward, leaving `clawed-back` rather than `rejected`. */
export async function clawbackReferral(id, reason) {
  return (await provider()).clawbackReferral(id, reason);
}

/**
 * The signed-in user's own summary — `{ code, invited, converted, contactsEarned, contactsPending }`.
 *
 * `code` is the one the product must hand out. A browser-minted code is a string
 * `POST /referrals/redeem` cannot resolve, so every link built around one is dead.
 *
 * `contactsEarned` / `contactsPending` are counts of **owner contacts**, not rupees: owner contacts
 * are what the scheme is advertised to pay, and rupees of platform credit would have nothing to be
 * spent on.
 *
 * These two are the *narrative* of the scheme — what this referrer has earned and what is still
 * waiting on the fraud desk. They are not the balance. The spendable balance is
 * `GET /me/entitlements` (`services/entitlementService.js`), which derives it from the referrals
 * that justify it, so a clawback moves it without anybody having to remember to.
 */
export async function getMyReferralSummary() {
  return (await provider()).getMyReferralSummary();
}

/**
 * Tell the server whose code brought this account in.
 *
 * A 409 means the code was unknown, was the caller's own, or had already been redeemed by this
 * account; the sign-up path swallows it, because the person who just created an account did not
 * choose the code and cannot fix it.
 */
export async function redeemReferral(code, shareChannel) {
  return (await provider()).redeemReferral(code, shareChannel);
}

/**
 * The share link for a code — `<origin>/signup?ref=<code>`.
 *
 * **The one export here that is not a provider call, deliberately.** The link is this deployment's
 * origin plus a code the caller already holds, so putting it behind the seam would mean a second
 * implementation of `origin + '/signup?ref='` kept in step by hand.
 *
 * The code is **required**, and the only one a caller has is the one `getMyReferralSummary()` just
 * returned. A default would let a page build a link around a browser-minted code that
 * `POST /referrals/redeem` cannot resolve, while reading the server's code for everything else —
 * exactly half right, with nothing at the call site to say so.
 *
 * A blank code returns `''` rather than a link ending in `?ref=`, because a Copy button that
 * reports success over a dead link is worse than one that has nothing to copy.
 */
export function referralLink(code) {
  const c = String(code || '').trim();
  if (!c) return '';
  const origin =
    (typeof window !== 'undefined' && window.location && window.location.origin) || 'https://draazy.com';
  return `${origin}/signup?ref=${encodeURIComponent(c)}`;
}
