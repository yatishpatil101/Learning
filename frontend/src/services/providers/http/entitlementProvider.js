/** No mapper: null `allowance`/`remaining` mean an unlimited plan and pass through, never become Infinity. */
import { PAGE_LOAD_TTL, get } from '../../http.js';

/** The signed-in user's allowances. 401 when there is no session. */
export async function getEntitlements() {
  return get('/me/entitlements', undefined, { ttl: PAGE_LOAD_TTL });
}
