package com.draazy.api.catalog.society;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** {@code vegPolicy} is surfaced because the filter is applied at the door whether or not it is shown. A null {@code mintOrigin}
 * means not recorded, not "not demand"; {@code avgRating} is null when unreviewed, as no rating is not zero. */
public record SocietyResponse(
        UUID id,
        String slug,
        String name,
        String builder,
        String localitySlug,
        Double lat,
        Double lng,
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
        java.time.Instant createdAt) {
}
