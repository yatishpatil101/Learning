/**
 * Entitlement Service — what the signed-in user is allowed to do, answered by whoever is serving.
 *
 * `GET /me/entitlements`.
 *
 * ## Why this domain exists
 *
 * Until D31b the browser owned the owner-contact quota outright: `lib/store/contactQuota.js` kept a
 * `pnContactsUsed:<mobile>` counter in localStorage, added `+15` per referral it had also counted
 * locally, and decided — synchronously, before any network call — whether the user was allowed to
 * ask for another owner's number. Every one of those three facts was a browser's opinion. Clearing
 * site data restored the quota; a second device never knew about the first; and the referral bonus
 * was minted by the same machine that spent it.
 *
 * The server now owns all of it. A "contact" is the right to open one `contact_requests` row, the
 * count of those rows *is* the used figure (the `uq_contact_requests_requester_property` unique
 * index makes the count race-proof), and the allowance is the plan's plus a bonus derived on the
 * spot from the referrals that justify it. This service is the only way the app asks for that
 * answer.
 *
 * ## The shape, and the one thing to be careful of
 *
 * ```
 * { contacts: { unlimited, used, allowance, remaining, referralBonus },
 *   listings: { allowance, referralBonus },
 *   agreements: { free } }
 * ```
 *
 * `agreements.free` is how many rent agreements the caller's referrals have earned them — qualified
 * referrals divided by three. There is no `used` and no `remaining`, and that is a scope statement
 * rather than an oversight: agreements are not sold through this codebase yet, so a consumption
 * tally would be a number nothing decrements. It is derived on every request like the two bonuses
 * above it, so a clawed-back referral takes the perk back with it.
 *
 * `allowance` and `remaining` are `null` when `unlimited` is true — not `Infinity`, not a very large
 * number. A caller must branch on `unlimited` rather than comparing `remaining > 0`, because
 * `null > 0` is false and an unlimited user would be told they had run out. The old local API hid
 * this by returning `Infinity`, which reads nicely and is not a thing JSON can carry.
 *
 * ## This is a mirror, not the gate
 *
 * Nothing here decides anything. The refusal lives in `POST /contacts/request`, which answers 422
 * `contact_quota_exhausted` when the allowance is spent; the numbers below exist so the UI can say
 * "3 left" *before* the user presses, and so the exhausted modal can show the arithmetic. A build
 * that read these numbers and then skipped the request would be back to trusting the browser.
 */
import { createProvider } from './config.js';

const provider = createProvider('entitlement');

/**
 * The signed-in user's allowances.
 *
 * Requires a session — an anonymous caller gets a 401, which callers should treat as "no numbers to
 * show" rather than "nothing allowed": a signed-out visitor is prompted to sign in, not told their
 * quota is spent.
 */
export async function getEntitlements() {
  return (await provider()).getEntitlements();
}
