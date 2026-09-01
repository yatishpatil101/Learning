/**
 * Referral Service — the fraud desk, and the referrer's own view of their scheme.
 *
 * `GET /me/referrals`, `POST /referrals/redeem`, `GET /referrals`,
 * `POST /referrals/{id}/approve|reject|clawback`.
 *
 * ## Two audiences, and only one of them has a mock
 *
 * `ReferralsController` states the split: "`GET /me/referrals` and `POST /referrals/redeem` are any
 * authenticated user's; the queue and the three decisions are the fraud desk's."
 *
 * The desk half is **staff-only**, and the header of this file used to say "live-only" of the whole
 * module. That was true when the module was only the desk, and it stopped meaning anything when the
 * mock was deleted (P5c). What the distinction recorded is worth keeping: the desk never had a
 * second implementation, because the mock's referral store had a `flagged` status the server does
 * not know, unmasked mobile numbers the server deliberately withholds, and an Approve that granted
 * a perk where the server pays rupees — three disagreements about what a referral *is*, not three
 * formatting differences. `OpsReferrals` gated itself shut and said why; the mock's desk methods
 * threw with that reason rather than returning something plausible. Both are gone and the desk is
 * live.
 *
 * The consumer half did have a mock, because none of those objections applied to it: a code is a
 * string and a count is a count. It reaches the same API as everything else now.
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

/**
 * The signed-in user's own summary — `{ code, invited, converted, contactsEarned, contactsPending }`.
 *
 * `code` is the one the product should be handing out. `Refer.jsx` used to mint its own in the
 * browser, so every link the product has ever produced carried a string `POST /referrals/redeem`
 * could not resolve.
 *
 * `contactsEarned` / `contactsPending` are counts of **owner contacts**, not rupees. Register item
 * 31 left the currency open — the server paid ₹500 and the browser granted quota, and no arithmetic
 * turned one into the other. D31b closed it by moving the server onto the browser's unit rather
 * than the other way round: a referral is worth owner contacts because owner contacts are what the
 * scheme was always advertised to pay, and rupees of platform credit had nothing to be spent on.
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
 * Resolves to `null` on a mock build, where the provider records the attribution with the local
 * `setReferredBy(code)` primitive and deliberately credits nobody. `Signup.jsx` used to call that
 * primitive itself, on every build, so a live sign-up wrote a localStorage key nothing live reads;
 * the write now sits below the seam with the rest of the mock's answer. A 409 means the code was
 * unknown, was the caller's own, or had already been redeemed by this account; the sign-up path
 * swallows it, because the person who just created an account did not choose the code and cannot
 * fix it.
 */
export async function redeemReferral(code, shareChannel) {
  return (await provider()).redeemReferral(code, shareChannel);
}

/**
 * The share link for a code — `<origin>/signup?ref=<code>`.
 *
 * **The one export here that is not a provider call, deliberately.** The link is the same string on
 * both builds: it is this deployment's origin plus a code the caller already holds, so putting it
 * behind the seam would mean two implementations of `origin + '/signup?ref='` kept in step by hand.
 *
 * It lives here rather than in `lib/store/referrals.js`, where it used to, for the opposite reason.
 * That version's signature was `referralLink(code = referralCode())` — omit the argument and it
 * built a link around the browser-minted `RAHU0011`, the string `POST /referrals/redeem` cannot
 * resolve. A page reading the server's code from `getMyReferralSummary()` and sharing a link built
 * from the browser's is exactly half right, and nothing about the call site said so. The code is
 * **required** here, and the only one a caller has is the one the summary just returned.
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
