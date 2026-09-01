/* Society trust flags, as stated by the server. */

/**
 * Normalises the two society trust flags. This module used to *invent* them:
 *
 *     const h = hashId(p.id);
 *     const societyVerified = (h >> 12) % 2 === 0;
 *     const conveyanceDone  = (h >> 14) % 5 < 2; // ~40%
 *
 * Both are legal facts about a named housing society — whether it is a registered body, and
 * whether conveyance (transfer of the land title from builder to society) has completed.
 * Conveyance decides whether a society can ever redevelop, and whether a buyer is purchasing
 * into a title dispute. They were dealt from a hash of the listing id, tuned to a plausible
 * 50% and 40% so the distribution would not invite questions, and both were offered as filters
 * with a badge on the card — so a buyer narrowing to "conveyance done" was served a set chosen
 * by arithmetic on a slug, each card affirming a check nobody had performed.
 *
 * Both have had `society_verified` / `conveyance_done` columns and narrow-only SQL predicates
 * since V95. The server states them; nothing here needs to guess. The columns are NOT NULL and
 * default false, and false is the safe direction: it never widens a result set and never badges
 * a listing with an unearned check.
 *
 * Kept as a normalisation seam rather than deleted so a fixture missing the keys still yields
 * booleans. Filtering on them moved to the server with the listings search, so nothing here
 * decides a result set any more; what is left is the badge on the card, which must say false
 * rather than `undefined` — the same rendering either way, but by statement rather than by
 * accident.
 */
export function enrichWithVerification(p) {
  return {
    ...p,
    societyVerified: p.societyVerified ?? false,
    conveyanceDone: p.conveyanceDone ?? false,
  };
}
