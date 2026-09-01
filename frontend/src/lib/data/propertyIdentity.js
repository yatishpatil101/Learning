/* Property identity & duplicate detection for whole-property listings.
 *
 * Mirrors the anti-broker fingerprint pattern already used for flatmate
 * (`flatmates.js`), but generalised for sale/rent/PG/commercial listings so the
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
import { digits, norm, pin, hashToken } from './identityNorm.js';

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

/* Derive the identity evidence a submission carries to the server.
 *
 * D245/D226. This used to *decide* things. Three arms scanned `rawDb()` — the browser's local
 * mirror — for listings that intersect these keys: the same owner re-listing a unit, a different
 * owner claiming it, and reuse of the same photographs. None of them could work where it mattered.
 * Against the live API that store holds only what this browser itself posted, so a real owner's
 * browser has never seen another owner's listing and, worse, could be refused over a seeded demo
 * fixture and then offered a link to an id the server had never issued. Every mock spec passed on a
 * feature that had never once fired in production.
 *
 * All three now run server-side against everybody's listings: the self-arm as
 * `propertyService.checkOwnDuplicate` → `POST /me/listings/duplicate-check`, the address and meter
 * arm in `ListingDuplicateProbe#flagSameDoorway` (V115 normalises the meter so three spellings of
 * one number are one number), and the photograph arm in `#flagSamePhotos` against
 * `property_photo_hashes` (V116).
 *
 * What is left here is only the evidence: the keys are computed in the browser because they are
 * derived from fields the wizard holds and are persisted onto the record the create sends. Judging
 * them is nobody's job on this side. */
export const evaluateListingDedup = ({ fields } = {}) => {
  const keys = fingerprintKeys(fields || {});
  return { fingerprint: keys[0] || '', fingerprintKeys: keys };
};
