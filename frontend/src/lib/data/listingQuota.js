/**
 * Listing quota — how many live listings the owner is allowed, and how many they hold. Both numbers
 * come from the server; this is a mirror for the wizard's paywall, never the gate, so it fails open.
 */
import { getEntitlements } from '../../services/entitlementService.js';
import { myListings } from '../../services/propertyService.js';

/**
 * The negative of the server's `PropertyStatus.OCCUPIES_LISTING_SLOT`, plus the `archived` boolean a
 * withdrawal sets while leaving status alone. Keep the two in step or the mirror paywalls wrongly.
 */
const OCCUPIES_A_SLOT = (l) => !l.flatmate && !l.archived
  && !/deleted|archived|rejected/i.test(String(l.status || ''));

/**
 * The owner's quota as both sides understand it: `{ used, allowance, canPost }`. `allowance` is
 * `null` when it could not be established, and `canPost` is then `true` — fail permissive.
 */
export async function loadListingQuota(user) {
  const [ent, mine] = await Promise.allSettled([getEntitlements(), myListings(user)]);

  const allowance = ent.status === 'fulfilled' && Number.isFinite(ent.value?.listings?.allowance)
    ? ent.value.listings.allowance
    : null;
  const used = mine.status === 'fulfilled'
    ? (mine.value || []).filter(OCCUPIES_A_SLOT).length
    : 0;

  return { used, allowance, canPost: allowance == null || used < allowance };
}
