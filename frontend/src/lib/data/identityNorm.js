/* Shared identity normalisers.
 *
 * The single source of truth for how we canonicalise the raw strings that feed
 * every dedup fingerprint (property listings AND flatmate groups/rooms). Kept
 * dependency-free (no localStorage / mockApi) so it is trivial to reason about
 * and to unit-test in pure Node, and so both `propertyIdentity.js` and
 * `flatmates.js` derive their keys from the exact same primitives.
 */

/* Strip everything but digits — used for phone/meter/pincode comparisons. */
export const digits = (m) => String(m || '').replace(/\D/g, '');

/* Trim, lowercase, and collapse internal whitespace so "  Skyline   Heights "
   and "skyline heights" normalise to one token. */
export const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/* A pincode is only meaningful when it is a full 6-digit Indian PIN. */
export const pin = (p) => (digits(p).length === 6 ? digits(p) : '');

/* Stable, non-reversible token (FNV-1a). Lets us store a dedup key derived from
   a private identifier (electricity meter / tax number) without ever persisting
   the raw value. Same input -> same base-36 token, so keys still compare equal. */
export const hashToken = (s) => {
  const str = String(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};
