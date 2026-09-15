/* Property identity & duplicate detection for whole-property listings, so one physical unit cannot
 * be published twice. Keys, strongest first: electricity consumer number, PMC property id, address.
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

/* Derive the identity evidence a submission carries; judging it is server-side work, since only the
 * server sees every owner's listings. Keys are derived from wizard fields the create persists. */
export const evaluateListingDedup = ({ fields } = {}) => {
  const keys = fingerprintKeys(fields || {});
  return { fingerprint: keys[0] || '', fingerprintKeys: keys };
};
