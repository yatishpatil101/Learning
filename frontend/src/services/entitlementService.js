/** `GET /me/entitlements`: a mirror for the UI ("3 left", the exhausted modal), never the gate; `POST /contacts/request` refuses with 422.
 * `allowance` and `remaining` are `null` when `unlimited`, so callers must branch on `unlimited`, not on `remaining > 0`. */
import { createProvider } from './config.js';

const provider = createProvider('entitlement');

/** An anonymous caller gets a 401: treat it as "no numbers to show", not "quota spent". */
export async function getEntitlements() {
  return (await provider()).getEntitlements();
}
