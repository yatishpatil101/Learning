/**
 * HTTP referral provider — the fraud desk (`/ops/referrals`), live against `GET /referrals` and
 * the three decisions.
 *
 * **There was never a second implementation, as with `ticketProvider`.** The mock referral store
 * could not express this endpoint's answers: it had a `flagged` status the server does not know, it
 * handed out unmasked mobile numbers the server deliberately withholds, and its Approve granted a
 * listing slot the contract has no field for — by looking the referrer up on a phone number that is
 * no longer on the wire. Translating those would have meant inventing a second fraud vocabulary and
 * keeping it in step by hand, which is the thing D184 refused, so `OpsReferrals` stated why it was
 * shut instead. The store is gone (P5c) and the desk is live.
 *
 * This paragraph used to end "…pays a perk where the server pays rupees". D31b reversed that half:
 * the server moved onto the browser's unit rather than the other way round, so both now pay owner
 * contacts and the rupee disagreement no longer exists. The other two stand, and so does the perk
 * one once it is stated accurately — a listing slot is not a thing `ReferralSummaryDto` can carry.
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
 * is a count of owner contacts (`rewardAmount`, surfaced to the referrer as `contactsEarned`), and
 * approving is the whole of the desk's part in paying it.
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

/**
 * `GET /me/referrals` — the referrer's own view, and the other audience on this resource.
 *
 * `ReferralsController`'s Javadoc calls it out: "Two audiences on one resource. `GET /me/referrals`
 * and `POST /referrals/redeem` are any authenticated user's; the queue and the three decisions are
 * the fraud desk's." Only the desk half was wired. This is the other half.
 *
 * Returned verbatim, with no mapper. `ReferralSummaryDto` is `(code, invited, converted,
 * contactsEarned, contactsPending)` — five scalars, all already in the shape the page wants, and
 * the reward is a plain count of owner contacts rather than money (D31b). A mapper here would exist
 * only to copy five fields, and every such mapper is one more place for the two shapes to drift
 * apart silently.
 *
 * ## What this fixes
 *
 * `Refer.jsx` used to mint its own code in the browser — four letters of the user's name and four
 * digits of their mobile — and every link the product has ever produced carried it. The server's is
 * `PUNE-AB12`, from `referral_codes` (V23), which is permanent by design: "One code per user,
 * forever — rotating it would break every card and forwarded message already carrying the old one."
 * Two codes for one user is one code too many, and the browser's was the one nothing could resolve.
 */
export async function getMyReferralSummary() {
  return get('/me/referrals');
}

/**
 * `POST /referrals/redeem` — the referee telling the server whose code brought them in.
 *
 * `shareChannel` is optional and unvalidated server-side on purpose (D60): it records how the link
 * travelled, and a wrong value is worse as a 400 than as a slightly muddy attribution statistic.
 *
 * A 409 means the code could not be redeemed — unknown, self-referral, or already used by this
 * account. The caller decides whether that is worth showing; on the sign-up path it is not, because
 * the person who just created an account did not choose the code and cannot fix it.
 */
export async function redeemReferral(code, shareChannel) {
  const channel = String(shareChannel || '').trim();
  return post('/referrals/redeem', { code, ...(channel ? { shareChannel: channel } : {}) });
}
