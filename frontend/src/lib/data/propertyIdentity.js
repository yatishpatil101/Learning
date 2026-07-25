/* Property identity & duplicate detection for whole-property listings.
 *
 * Mirrors the anti-broker fingerprint pattern already used for flat-share
 * (`shareFlat.js`), but generalised for sale/rent/PG/commercial listings so the
 * same physical unit can't be published twice.
 *
 * A property is identified by a set of keys, strongest -> weakest:
 *   1. Electricity consumer number (MSEDCL) — unique per metered unit, works for
 *      rent AND buy. The single most reliable per-unit identifier we can ask for.
 *   2. PMC Property ID / tax-receipt PTIN — unique per assessed unit.
 *   3. Structured address — normalized(society + unit + pincode) + locality.
 *
 * Two submissions are the "same property" when their key sets intersect, so a
 * new listing that carries an electricity number still matches an older
 * address-only listing of the same flat.
 */
import { rawDb } from '../mockApi.js';
import { digits, norm, pin, hashToken } from './identityNorm.js';
import { photoSetsMatch } from './imageHash.js';

export { digits };

/* The unit token distinguishes flats within one society/building — a flat number
   or, failing that, the tower/wing. Without it the whole society collapses to one
   key, so we only build the strong address key when we have a society at least. */
const unitToken = ({ flatNumber, tower } = {}) => norm(flatNumber) || norm(tower);

/* All identity keys derivable from a set of property fields. Order is priority. */
export const fingerprintKeys = (fields = {}) => {
  const keys = [];
  const ec = digits(fields.electricityConsumerNo);
  if (ec.length >= 6) keys.push('ec:' + hashToken(ec));
  const pid = norm(fields.pmcPropertyId).replace(/[^a-z0-9]/g, '');
  if (pid.length >= 4) keys.push('pid:' + hashToken(pid));
  const soc = norm(fields.society);
  const unit = unitToken(fields);
  // Only a society *with a unit* is specific enough to identify one flat — a bare
  // society name would false-match every other flat in the same building.
  if (soc && unit) {
    const loc = norm(fields.locality);
    keys.push('addr:' + [soc, unit, pin(fields.pincode), loc].join('|'));
  }
  return keys;
};

/* The single strongest key, used for storage/display and quick equality. */
export const propertyFingerprint = (fields = {}) => fingerprintKeys(fields)[0] || '';

/* A listing still occupies its address while it is pending or live. Archived,
   rejected, sold or expired listings free the address for a fresh post. */
export const listingActive = (l) =>
  !!l && !l.archived && !/rejected|sold|expired|deleted|removed/i.test(String(l.status || ''));

/* Keys for an already-stored listing: prefer the keys captured at submit time,
   fall back to recomputing from whatever address fields the record carries so
   legacy listings (posted before this feature) still dedupe on address. */
export const keysForListing = (l) =>
  Array.isArray(l.fingerprintKeys) && l.fingerprintKeys.length
    ? l.fingerprintKeys
    : fingerprintKeys({
        electricityConsumerNo: (l.strongIds && l.strongIds.electricityConsumerNo) || l.electricityConsumerNo,
        pmcPropertyId: (l.strongIds && l.strongIds.pmcPropertyId) || l.pmcPropertyId,
        society: l.society,
        flatNumber: l.flatNumber,
        tower: l.tower,
        pincode: l.pincode,
        locality: l.locality,
      });

/* Active listings whose identity intersects `keys`, excluding `excludeId`
   (the listing being edited). Each claim carries the owner's mobile digits so
   the caller can tell self-duplication from a different owner's claim. */
export const findListingClaims = (keys, excludeId) => {
  if (!keys || !keys.length) return [];
  const want = new Set(keys);
  const db = rawDb();
  const claims = [];
  (db.listings || []).forEach((l) => {
    if (l.id === excludeId || !listingActive(l)) return;
    if (keysForListing(l).some((k) => want.has(k))) {
      claims.push({ id: l.id, mobile: digits(l.ownerMobile), status: l.status });
    }
  });
  return claims;
};

/* Active listings whose photos perceptually match `hashes`, excluding `excludeId`.
   A FUZZY signal (re-compressed copy-paste), so callers only ever FLAG on it —
   never block — to avoid false-matching a reused stock/amenity photo. */
export const findImageClaims = (hashes, excludeId) => {
  if (!Array.isArray(hashes) || !hashes.length) return [];
  const db = rawDb();
  const claims = [];
  (db.listings || []).forEach((l) => {
    if (l.id === excludeId || !listingActive(l)) return;
    if (Array.isArray(l.photoHashes) && photoSetsMatch(hashes, l.photoHashes)) {
      claims.push({ id: l.id, mobile: digits(l.ownerMobile), status: l.status });
    }
  });
  return claims;
};

/* Decide what to do with a submission against existing supply:
 *   - blocked   : the SAME owner already has this property live -> stop, offer edit.
 *   - flagged   : a DIFFERENT owner already claimed it (by identity OR by matching
 *                 photos) -> allow, route to Ops with the reason.
 * Returns the keys + primary fingerprint to persist onto the new record. */
export const evaluateListingDedup = ({ mobile, fields, excludeId, photoHashes } = {}) => {
  const keys = fingerprintKeys(fields || {});
  const fingerprint = keys[0] || '';
  const mine = digits(mobile);

  // Strong signal: shared identity key. Same owner -> block; other owner -> flag.
  const claims = keys.length ? findListingClaims(keys, excludeId) : [];
  const self = claims.find((c) => mine && c.mobile === mine);
  const other = claims.find((c) => c.mobile && c.mobile !== mine);

  // Fuzzy signal: matching photos against a DIFFERENT owner. Only consulted when
  // we aren't already blocking, and never turns into a block on its own.
  let imageOther = null;
  if (!self && Array.isArray(photoHashes) && photoHashes.length) {
    imageOther = findImageClaims(photoHashes, excludeId).find((c) => c.mobile && c.mobile !== mine) || null;
  }

  const flaggedByAddress = !self && !!other;
  const flaggedByImage = !self && !other && !!imageOther;
  return {
    fingerprint,
    fingerprintKeys: keys,
    blocked: !!self,
    existingId: self ? self.id : null,
    flagForReview: flaggedByAddress || flaggedByImage,
    flaggedAgainstId: flaggedByAddress ? other.id : flaggedByImage ? imageOther.id : null,
    flagBy: flaggedByAddress ? 'address' : flaggedByImage ? 'image' : null,
  };
};
