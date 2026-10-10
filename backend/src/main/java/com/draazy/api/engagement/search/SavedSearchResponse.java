package com.draazy.api.engagement.search;

import java.time.Instant;

/** Wire shape is byte-for-byte per spec. {@code matchCount} is computed on read (live rows matching the
 * facets, regardless of age), while {@code newCount} is a stored column. */
public record SavedSearchResponse(
        String id,
        String name,
        String kind,
        String query,
        Object filters,
        Object criteria,
        String label,
        String alertFrequency,
        String channel,
        int newCount,
        int matchCount,
        Instant createdAt) {

    /** A wither, not a second constructor: the mapper cannot supply the count, and a build path
     * that omits a field is how a field gets forgotten. */
    SavedSearchResponse withMatchCount(int count) {
        return new SavedSearchResponse(id, name, kind, query, filters, criteria, label,
                alertFrequency, AlertChannels.PUSH, newCount, count, createdAt);
    }
}
