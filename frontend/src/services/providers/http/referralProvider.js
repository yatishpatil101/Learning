/**
 * HTTP referral provider — the fraud desk (`/ops/referrals`) and the referrer's own view. Both
 * mobiles stay masked: the desk works from server-computed signals, not from the evidence.
 */
import { get, post } from '../../http.js';
import { toDecision, toViewModelPage } from './referralMapper.js';

/**
 * The queue, paged, staff or admin only. `status` and `risk` are the server's only filters — there
 * is no `flagged` status. Errors propagate: "no referrals here" would be worse than "could not look".
 */
export async function listReferralQueue({ status, risk, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (status) query.status = status;
  if (risk) query.risk = risk;
  return toViewModelPage(await get('/referrals', query), { page, size });
}

/**
 * Approve — releases the reward. A 409 means no identity badge or an undecidable state; its
 * message is the sentence to show.
 */
export async function approveReferral(id) {
  return toDecision(await post(`/referrals/${encodeURIComponent(id)}/approve`));
}

/** Reject — `POST /referrals/{id}/reject`. The reason is audit context, not a gate. */
export async function rejectReferral(id, reason) {
  return toDecision(await post(`/referrals/${encodeURIComponent(id)}/reject`, reasonBody(reason)));
}

/**
 * Clawback — only a `rewarded` referral can be reversed, and the result is `clawed-back`, not
 * `rejected`: a fraud desk needs "never paid" and "paid then recovered" kept apart.
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
 * `GET /me/referrals` — the referrer's own view. Returned verbatim: `ReferralSummaryDto` is five
 * scalars already in the page's shape, and a copying mapper is just somewhere to drift.
 */
export async function getMyReferralSummary() {
  return get('/me/referrals');
}

/**
 * `POST /referrals/redeem` — the referee names whose code brought them in. `shareChannel` is
 * deliberately unvalidated; a 409 (unknown, self-referral, already used) is not worth showing at sign-up.
 */
export async function redeemReferral(code, shareChannel) {
  const channel = String(shareChannel || '').trim();
  return post('/referrals/redeem', { code, ...(channel ? { shareChannel: channel } : {}) });
}
