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
 * @param newCount        stored column, currently always 0 — see class Javadoc on D8.8
 * @param createdAt       row creation
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
        Instant createdAt) {
}
