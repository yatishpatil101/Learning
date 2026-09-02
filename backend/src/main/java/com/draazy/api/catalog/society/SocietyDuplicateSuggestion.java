package com.draazy.api.catalog.society;

/**
 * One society that might be the same building as a candidate in the ops queue.
 *
 * <p><strong>A hint, never a claim.</strong> Nothing downstream acts on this: the merge it points at
 * is a separate, explicit {@code POST /admin/society-merges} that an operator has to choose. That is
 * why {@code score} is on the wire at all — the console renders the strongest match first and the
 * operator can see how confident the guess is, rather than being handed a ranked list whose ranking
 * is invisible. "kumar-pinnacle" and "kumar-pinnacle-phase-1" may be one building or two, and only a
 * person can say.
 *
 * @param verified whether the target is a row worth merging <em>into</em> — a curated or RERA
 *     society, or a community one an operator has already confirmed. Merging canonicalises towards
 *     the trusted record, so these sort first; merging the verified row into the junk one is the
 *     mistake this ordering exists to make unlikely.
 * @param score    shared distinctive name tokens over the distinct words in either name, plus a
 *     quarter for sharing the locality. Deliberately not a probability and deliberately not rounded
 *     away: the operator is being shown the strength of a guess, and a bare ordering hides how close
 *     the second place was.
 */
public record SocietyDuplicateSuggestion(
        String slug,
        String name,
        String localitySlug,
        boolean verified,
        double score) {
}
