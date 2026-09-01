package com.punenest.api.engagement.search;

import java.time.Instant;

/**
 * Contract {@code SavedSearch} wire shape. Field names are byte-for-byte per spec.
 *
 * @param id              opaque id
 * @param name            user-given name, nullable
 * @param kind            listings|flatmates — which discovery surface this alert watches
 * @param query           the persisted search text; null on a flatmates alert
 * @param filters         the facet filters as a free-form object (serialized from stored jsonb)
 * @param criteria        the flatmates filter set; null on a listings alert
 * @param label           short human summary for the alert card
 * @param mobile          set only for the signed-out lead path
 * @param alertFrequency  off|instant|daily|weekly
 * @param channel         whatsapp|sms|email|push
 * @param newCount        stored column — matches that arrived since the sweep's last baseline, and
 *                        zero again once the alert has gone out. See D8.8 on the service.
 * @param matchCount      computed on the read — how many live listings match these facets at all,
 *                        regardless of age. Zero on a flatmates alert, which this count does not
 *                        cover. Not a column; see D227 on the service.
 */
public record SavedSearchResponse(
        String id,
        String name,
        String kind,
        String query,
        Object filters,
        Object criteria,
        String label,
        String mobile,
        String alertFrequency,
        String channel,
        int newCount,
        int matchCount,
        Instant createdAt) {

    /**
     * This response with its match count filled in.
     *
     * <p>The mapper builds every other field from the row and cannot supply this one, so it maps
     * zero and the service replaces it. A wither rather than a second constructor because the
     * record <em>is</em> the contract shape: adding a build path that omits a field is how a field
     * starts being forgotten.
     */
    SavedSearchResponse withMatchCount(int count) {
        return new SavedSearchResponse(id, name, kind, query, filters, criteria, label, mobile,
                alertFrequency, channel, newCount, count, createdAt);
    }
}
