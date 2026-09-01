/**
 * Mock entitlement provider — `GET /me/entitlements` against localStorage.
 *
 * The arithmetic lives in `./contactQuota.js`, which is the file that used to be
 * `lib/store/contactQuota.js` and used to be importable by any component. Moving it behind this
 * provider is the substance of D31b on the mock build: the numbers are the same, but the only way
 * to reach them is now the same asynchronous call the http build makes, so a component cannot
 * accidentally consult the quota synchronously and skip the network.
 *
 * `allowance` and `remaining` are `null` on an unlimited plan, matching the server exactly. It is
 * tempting to return `Infinity` here — the old local API did, and it makes `remaining > 0` work
 * without a branch — but `Infinity` does not survive JSON, so the http build would hand back `null`
 * and the mock build would hand back something that behaves differently. A caller must branch on
 * `unlimited`, and this provider is shaped to make that failure show up on both builds or neither.
 */
import { delay } from '../../../lib/mockApi/core.js';
import { entitlements } from './contactQuota.js';

/** The signed-in user's allowances. */
export async function getEntitlements() {
  await delay();
  return entitlements();
}
