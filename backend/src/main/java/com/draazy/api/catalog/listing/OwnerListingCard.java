package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.ListingProgress;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;

/** The owner's My Listings row: what the card, its chips and the quality score read, and nothing else.
 * The full record is {@code GET /me/listings/{id}}. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record OwnerListingCard(
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
        String societyId,
        String coverImage,
        String status,
        String dealStatus,
        String freshness,
        ListingProgress progress,
        Instant createdAt,
        Instant lastConfirmedAt,
        Instant ownershipRequestedAt,
        String ownershipDeclinedReason,
        boolean featured,
        boolean archived,
        boolean recheckPending,
        String recheckReason,
        boolean ownerVerified,
        boolean ownershipVerified,
        int views,
        int enquiries,
        int docsCount,
        int pendingLeads,
        int photoCount,
        int descLength,
        int amenityCount,
        String facing,
        Integer floor,
        Integer ageYears,
        Long deposit,
        String availableFrom,
        String possession) {
}
