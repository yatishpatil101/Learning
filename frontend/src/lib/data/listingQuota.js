/**
 * Listing quota — how many live listings the signed-in owner is allowed, and how many they have.
 *
 * ## Why this is not `lib/store/billing.js` any more
 *
 * The freemium ceiling used to be decided entirely in the browser. `canPostListing()` compared
 * `activeListingCount()` — a count of the listings *this browser's localStorage happened to hold* —
 * against `listingLimit()`, which added `referralBonusListings()`, a bonus the same machine had
 * minted for itself. Both halves were a browser's opinion, and they disagreed with the server in
 * opposite directions: an owner who posted from their laptop and then opened the wizard on their
 * phone had a used-count of zero and was waved through past their ceiling, while an owner who
 * cleared site data lost referral slots they had genuinely earned.
 *
 * Both numbers now come from whoever is serving:
 *
 *   - `allowance` from `GET /me/entitlements` (`listings.allowance`), which is the plan's ceiling
 *     **plus** the referral bonus the server derives from the referrals that justify it. There is
 *     no client-side addition left to do — adding `referralBonusListings()` on top would count the
 *     same referrals twice.
 *   - `used` from `GET /me/listings`, which returns the owner's listings at every status. Public
 *     search is hard-floored to approved, so it cannot answer this: a pending or rejected listing
 *     still occupies a slot and is invisible to the catalogue.
 *
 * ## This is a mirror, not the gate
 *
 * `POST /me/listings` refuses over-quota posts on its own, with `422 listing_quota_exhausted`.
 * These numbers exist so the wizard can show a paywall *before* the owner fills in three steps of a
 * form, and so the paywall can print the real ceiling. That is why every failure path here is
 * permissive: a network blip must not paywall an owner who is entitled to post, because the server
 * will still say no if they are not.
 *
 * The exit from the ceiling is `DELETE /me/listings/{id}` — taking a listing down frees its slot
 * immediately, which is what makes the tier a tier rather than a one-way door.
 */
import { getEntitlements } from '../../services/entitlementService.js';
import { myListings } from '../../services/propertyService.js';

/**
 * A listing occupies a slot unless it has been taken down or refused.
 *
 * The authoritative list is `PropertyStatus.OCCUPIES_LISTING_SLOT` on the server — pending,
 * approved, flagged, sold and rented. This predicate is its negative, and the interesting exclusion
 * is `rejected`: a listing moderation turned down is not occupying anything the owner can use, and
 * charging them a slot for it would let a moderator permanently spend a free-tier owner's entire
 * allowance. Flatmate posts never consume quota on either side.
 *
 * Keep the two in step. A mirror that counts something the gate does not shows a paywall the server
 * would have let through, which is the one failure this file's permissiveness cannot cover.
 */
const OCCUPIES_A_SLOT = (l) => !l.flatmate && !/deleted|archived|rejected/i.test(String(l.status || ''));

/**
 * The owner's quota, as both sides currently understand it.
 *
 * Returns `{ used, allowance, canPost }`. `allowance` is `null` when it could not be established,
 * and `canPost` is then `true` — see the note above about failing permissive.
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
