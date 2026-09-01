/**
 * Referral Service — the fraud desk.
 *
 * `GET /referrals`, `POST /referrals/{id}/approve|reject|clawback`.
 *
 * ## Live-only, and why
 *
 * There is no mock provider. `lib/mockApi.js`'s referral store has a `flagged` status the server
 * does not know, unmasked mobile numbers the server deliberately withholds, and an Approve that
 * grants a perk where the server pays rupees. That is three disagreements about what a referral
 * *is*, not three formatting differences, so `OpsReferrals` gates on `isHttpDomain('referral')` and
 * states why it is shut — the same call D184 made for the drafting desk.
 *
 * ## The rules that are no longer this layer's business
 *
 * - **Whether a referral may be approved.** The referred party must hold an Aadhaar badge. That
 *   rule was greyed-out button in the browser until wave 2c while the endpoint paid anyone who
 *   asked; it is now `ReferralService.approve`, and a refusal arrives as a 409 with the sentence to
 *   show. The client still disables the button, but as a mirror rather than as the rule.
 * - **Which states a decision may be made from.** `pending` and `qualified` may be approved or
 *   rejected; only `rewarded` may be clawed back. Anything else is a 409.
 * - **What the reward is worth.** `rewardAmount`, from platform settings at redeem time.
 * - **How risky a referral looks.** `risk` is computed from the signals server-side. The desk reads
 *   it and filters on it; it does not derive it.
 *
 * ## What no client can do any more
 *
 * See a referrer's or referee's real phone number. Both are masked on this list, and there is no
 * unmasked single-record read to fall back to. The mock's `creditReferrer({ mobile: … })` depended
 * on one, which is the concrete reason the perk grant could not be ported — see the migration
 * README's wave 2c entry.
 */
import { createProvider } from './config.js';

const provider = createProvider('referral');

/**
 * A page of the queue.
 *
 * `status` and `risk` are the server's filters. There is no `flagged` status — the board's old
 * Flagged tab is now a **High risk** tab reading the `risk` field, which is the question it was
 * always asking. The desk pulls a window and groups it in the browser, so the filters here are for
 * a caller that wants one slice; they are not what draws the tabs.
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
