package com.draazy.api.moderation.property;

import com.draazy.api.catalog.property.ListingProgress;
import com.draazy.api.catalog.property.PropertyResponse;
import com.draazy.api.moderation.signal.ListingSignals;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;

/** The owner's number stays because the row prints it for the call;
 * the full record is {@code GET /admin/properties/{id}}. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PropertyQueueRow(
        String id,
        String slug,
        String title,
        String deal,
        String propertyType,
        BigDecimal bhk,
        Long price,
        BigDecimal area,
        String areaUnit,
        String furnishing,
        String locality,
        String localitySlug,
        String city,
        String coverImage,
        String status,
        ListingProgress progress,
        Instant createdAt,
        Instant lastConfirmedAt,
        String freshness,
        Instant resubmittedAt,
        Instant ownershipRequestedAt,
        boolean recheckPending,
        String recheckReason,
        Instant recheckRequestedAt,
        boolean featured,
        boolean archived,
        boolean ownerVerified,
        boolean ownershipVerified,
        int views,
        int enquiries,
        int docsCount,
        int photoCount,
        int descLength,
        int amenityCount,
        String facing,
        Integer floor,
        Integer ageYears,
        Long deposit,
        String availableFrom,
        String possession,
        PropertyResponse.Owner owner,
        PropertyResponse.AdminPipeline adminPipeline,
        ListingSignals signals,
        boolean ownerReplied) {
}
