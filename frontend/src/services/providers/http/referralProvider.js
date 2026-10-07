/** HTTP referral provider — the fraud desk (`/ops/referrals`) and the referrer's own view. */
import { get, post } from '../../http.js';
import { toDecision, toViewModelPage } from './referralMapper.js';

/** Errors propagate: "no referrals here" would be worse than "could not look". */
export async function listReferralQueue({ status, risk, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (status) query.status = status;
  if (risk) query.risk = risk;
  return toViewModelPage(await get('/referrals', query), { page, size });
}

/** A 409 means no identity badge or an undecidable state; its message is the sentence to show. */
export async function approveReferral(id) {
  return toDecision(await post(`/referrals/${encodeURIComponent(id)}/approve`));
}

/** Reject — `POST /referrals/{id}/reject`. The reason is audit context, not a gate. */
export async function rejectReferral(id, reason) {
  return toDecision(await post(`/referrals/${encodeURIComponent(id)}/reject`, reasonBody(reason)));
}

/** Result is `clawed-back`, not `rejected`: a fraud desk must tell "never paid" from "paid then recovered". */
export async function clawbackReferral(id, reason) {
  return toDecision(await post(`/referrals/${encodeURIComponent(id)}/clawback`, reasonBody(reason)));
}

/** The body is optional in the contract, so a blank reason is sent as no body rather than as `""`. */
function reasonBody(reason) {
  const text = String(reason || '').trim();
  return text ? { reason: text } : undefined;
}

/** Returned verbatim: the DTO already matches the page's shape, and a copying mapper is a place to drift. */
export async function getMyReferralSummary() {
  return get('/me/referrals');
}

/** `shareChannel` is deliberately unvalidated; a 409 (unknown, self or used code) isn't shown at sign-up. */
export async function redeemReferral(code, shareChannel) {
  const channel = String(shareChannel || '').trim();
  return post('/referrals/redeem', { code, ...(channel ? { shareChannel: channel } : {}) });
}
