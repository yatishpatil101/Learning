package com.draazy.api.catalog.society;

/** A hint, never a claim: the merge it points at is a separate explicit {@code POST /admin/society-merges}.
 * {@code score} is exposed so the operator can see how confident the guess is. */
public record SocietyDuplicateSuggestion(
        String slug,
        String name,
        String localitySlug,
        double score) {
}
