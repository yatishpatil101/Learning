/** Approval rules, decision states, reward value and risk are server-owned; the client only mirrors them. */
import { createProvider } from './config.js';

const provider = createProvider('referral');

/** `counts` asks for whole-table tab totals; the High risk tab reads `risk`, as there is no `flagged` status. */
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

/** `code` must be the server's: a browser-minted code can't be redeemed. Counts are owner contacts;
 * the spendable balance lives in entitlements. */
export async function getMyReferralSummary() {
  return (await provider()).getMyReferralSummary();
}

/** A 409 (unknown, own or already redeemed code) is swallowed at sign-up: the new user can't fix it. */
export async function redeemReferral(code, shareChannel) {
  return (await provider()).redeemReferral(code, shareChannel);
}

/** Not behind the provider seam: it's origin plus a held code. A blank code returns '' rather than a dead
 * `?ref=` link, so Copy has nothing to falsely confirm. */
export function referralLink(code) {
  const c = String(code || '').trim();
  if (!c) return '';
  const origin =
    (typeof window !== 'undefined' && window.location && window.location.origin) || 'https://draazy.com';
  return `${origin}/signup?ref=${encodeURIComponent(c)}`;
}
