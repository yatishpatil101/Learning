package com.punenest.api.engagement.flatmate;

/**
 * The group-feed filter as the page offers it: locality, join policy, and a per-flat rent range.
 * Optional throughout, so the all-null instance is the default page load. {@code policy} reads the
 * literal {@code any} (open-join) as no preference — see {@link FlatmateVocabulary#facetOrNull}.
 */
public record GroupFacets(String locality, String policy, Long minRent, Long maxRent) {
}
