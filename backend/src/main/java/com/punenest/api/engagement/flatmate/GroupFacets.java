package com.punenest.api.engagement.flatmate;

/**
 * The group-feed filter as the page offers it: locality, join policy, a per-flat rent range, and
 * the trust toggle. Optional throughout, so the all-null instance is the default page load.
 * {@code policy} reads the literal {@code any} (open-join) as no preference — see
 * {@link FlatmateVocabulary#facetOrNull}.
 *
 * <p>{@code verifiedOnly} is a {@link Boolean} rather than a {@code boolean} so that "absent" and
 * "explicitly off" are the same widening value and neither can be confused with a filter the
 * caller asked for.
 */
public record GroupFacets(String locality, String policy, Long minRent, Long maxRent,
        Boolean verifiedOnly) {
}
