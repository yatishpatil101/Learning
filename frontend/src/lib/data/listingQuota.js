/** Mirror of `GET /me/entitlements` for the wizard's paywall, never the gate, so it fails open. */
import { getEntitlements } from '../../services/entitlementService.js';

/** `{ used, allowance, canPost }`; an unknown `allowance` is `null` and `canPost` then stays `true`. */
export async function loadListingQuota() {
  const listings = await getEntitlements().then((e) => e?.listings, () => null);
  const allowance = Number.isFinite(listings?.allowance) ? listings.allowance : null;
  const used = Number(listings?.used) || 0;
  return { used, allowance, canPost: allowance == null || used < allowance };
}
