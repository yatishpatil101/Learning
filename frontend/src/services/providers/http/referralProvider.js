/**
 * HTTP referral provider — the fraud desk (`/ops/referrals`), live against `GET /referrals` and
 * the three decisions.
 *
 * **Live-only, like `ticketProvider`.** `lib/mockApi.js`'s referral store cannot express this
 * endpoint's answers: it has a `flagged` status the server does not know, it hands out unmasked
 * mobile numbers the server deliberately withholds, and its Approve pays a perk (a listing slot,
 * or +15 contacts) where the server pays rupees. Translating those would mean inventing a second
 * fraud vocabulary and keeping it in step by hand, which is the thing D184 refused. `OpsReferrals`
 * gates on `isHttpDomain('referral')` and states why it is shut.
 *
 * ## Both mobiles are masked and stay masked
 *
 * `ReferralDto` masks `referrerMobile` and `referredMobile`, because the platform's rule for a
 * privileged *list* is that it is masked and an unmasked read is a separate, audited, single-record
 * operation. The contract declares no such operation for referrals, so there is nothing to call.
 * The desk's job is served by the signals instead, which are computed server-side from the
 * unmasked data — the checker sees the finding without seeing the evidence.
 *
 * This is what retires `creditReferrer({ mobile: r.referrerMobile, ... })`: the mock granted a perk
 * by looking the referrer up by phone number, and that number is no longer on the wire. The reward
 * is money now (`rewardAmount`, surfaced to the referrer as `rewardsEarned`), and approving is the
 * whole of the desk's part in paying it.
 *
 * ## The Aadhaar rule moved to the server in this wave
 *
 * `canQualify(r)` used to grey out Approve in the browser under a banner calling the check
 * mandatory, while `POST /referrals/{id}/approve` released the money to anyone who called it. The
 * rule now lives in `ReferralService.approve` and answers a 409 whose message names the reason, so
 * the button is a mirror of a real rule rather than the rule itself.
 */
import { get, post } from '../../http.js';
import { toDecision, toViewModelPage } from './referralMapper.js';

/**
 * The queue — `GET /referrals`, paged, staff or admin only.
 *
 * `status` and `risk` are the server's two filters. `risk=high` is what the board's old **Flagged**
 * tab was reaching for: there is no `flagged` status, and a tab filtering on one would have sat
 * permanently empty — a fraud desk being told there is nothing suspicious.
 *
 * Errors propagate: a fraud queue that renders a failed read as "no referrals here" is worse than
 * one that says it could not look.
 */
export async function listReferralQueue({ status, risk, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (status) query.status = status;
  if (risk) query.risk = risk;
  return toViewModelPage(await get('/referrals', query), { page, size });
}

/**
 * Approve — `POST /referrals/{id}/approve`. Releases the reward.
 *
 * No body. Refused with a 409 when the referred party holds no Aadhaar badge, or when the referral
 * is in a state a checker cannot decide from; either way the message is the sentence to show.
 */
export async function approveReferral(id) {
  return toDecision(await post(`/referrals/${encodeURIComponent(id)}/approve`));
}

/** Reject — `POST /referrals/{id}/reject`. The reason is audit context, not a gate. */
export async function rejectReferral(id, reason) {
  return toDecision(await post(`/referrals/${encodeURIComponent(id)}/reject`, reasonBody(reason)));
}

/**
 * Clawback — `POST /referrals/{id}/clawback`. Only a `rewarded` referral can be reversed.
 *
 * The result is `clawed-back`, **not** `rejected` as the mock wrote. The distinction is the one a
 * fraud desk actually needs: a reward that was never paid, versus one that was paid and recovered.
 */
export async function clawbackReferral(id, reason) {
  return toDecision(await post(`/referrals/${encodeURIComponent(id)}/clawback`, reasonBody(reason)));
}

/** The body is optional in the contract, so a blank reason is sent as no body rather than as `""`. */
function reasonBody(reason) {
  const text = String(reason || '').trim();
  return text ? { reason: text } : undefined;
}
