/**
 * HTTP entitlement provider — `GET /me/entitlements`.
 *
 * There is no mapper. The endpoint was designed for this call site in D31b, so the wire shape and
 * the view shape are the same object, and inserting a translation layer whose every line reads
 * `x: dto.x` would only create a place for the two to drift apart.
 *
 * The one thing worth naming: `allowance` and `remaining` arrive as `null` for an unlimited plan.
 * That is the server's deliberate choice — see `ContactEntitlementDto` — and it is passed through
 * untouched rather than being converted to `Infinity` for the convenience of arithmetic. The mock
 * provider does the same, so a caller that mishandles the null case fails on both builds instead of
 * only in production.
 */
import { get } from '../../http.js';

/** The signed-in user's allowances. 401 when there is no session. */
export async function getEntitlements() {
  return get('/me/entitlements');
}
