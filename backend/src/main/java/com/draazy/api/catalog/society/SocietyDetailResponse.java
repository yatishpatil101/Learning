package com.draazy.api.catalog.society;

import com.draazy.api.catalog.property.PropertySummary;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** The spec composes this with {@code allOf}, so base fields are repeated; {@code reviews} stays empty because they are
 * served paged from {@code GET /reviews/society/{slug}}. */
public record SocietyDetailResponse(
        UUID id,
        String slug,
        String name,
        String builder,
        String localitySlug,
        Double lat,
        Double lng,
        String placeId,
        Integer year,
        Integer towers,
        Integer units,
        BigDecimal occupancy,
        BigDecimal maintenancePerSqft,
        BigDecimal parkingRatio,
        Integer lifts,
        String security,
        String water,
        String power,
        String petPolicy,
        String vegPolicy,
        String rera,
        boolean registration,
        boolean conveyance,
        List<String> amenities,
        String source,
        String mintOrigin,
        long listingCount,
        long followerCount,
        boolean followedByMe,
        BigDecimal avgRating,
        long reviewCount,
        java.time.Instant createdAt,
        List<PropertySummary> homes,
        List<Object> reviews) {
}
