/* Enrich properties with society-verified and conveyance-done flags (deterministic) */
import { fnvHash as hashId } from '../hash.js';

/**
 * Enriches a property with societyVerified and conveyanceDone flags
 * based on deterministic hash from ID (so the same ID always yields the same flags).
 * HTML verification matrix (per-listing) mapped to [ownerVerified, ownershipVerified, societyVerified, conveyanceDone]:
 * [[1,1,1,1],[1,1,1,1],[1,0,1,0],[1,0,1,1],[1,1,0,0],[1,1,1,1],[0,0,0,0],[1,1,1,0],
 *  [1,0,1,1],[1,1,1,1],[0,0,0,0],[1,0,1,0],[1,0,0,0],[0,0,0,0]]
 * Approx 50% of properties have societyVerified, 40% have conveyanceDone
 */
export function enrichWithVerification(p) {
  const h = hashId(p.id);
  const societyVerified = (h >> 12) % 2 === 0;
  const conveyanceDone = (h >> 14) % 5 < 2; // ~40%
  return { ...p, societyVerified, conveyanceDone };
}
