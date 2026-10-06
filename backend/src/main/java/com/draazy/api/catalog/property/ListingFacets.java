package com.draazy.api.catalog.property;

import java.math.BigDecimal;
import java.util.List;

/** Every component means "do not filter" when absent: docs/flows/consumer/search-listings.md#94-facet-semantics. */
public record ListingFacets(
        List<String> types,
        List<String> commercialUses,
        List<String> bhks,
        List<String> furnishings,
        List<String> localities,
        List<String> societies,
        List<String> amenities,
        List<String> facing,
        List<String> landUse,
        List<String> room,
        List<String> tenants,
        List<String> construction,
        String availableFrom,
        Boolean pets,
        Boolean ownerVerified,
        Boolean ownershipVerified,
        Boolean rera,
        Boolean societyVerified,
        Boolean conveyanceDone,
        String food,
        List<String> shell,
        Boolean preLeased,
        List<String> na,
        BigDecimal minArea,
        BigDecimal maxArea,
        Integer minBaths,
        Integer minAge,
        Integer maxAge,
        Integer minFloor,
        Integer maxFloor,
        Long minDeposit,
        Long maxDeposit,
        Double nearLat,
        Double nearLng,
        Double nearRadiusKm,
        List<String> ids,
        Integer minPhotos) {

    public ListingFacets(List<String> types, List<String> commercialUses, List<String> bhks,
            List<String> furnishings, List<String> localities, List<String> societies,
            List<String> amenities, List<String> landUse, List<String> room, List<String> tenants,
            List<String> construction, String availableFrom, Boolean pets, Boolean ownerVerified,
            Boolean ownershipVerified, Boolean rera, Boolean societyVerified, Boolean conveyanceDone,
            BigDecimal minArea, BigDecimal maxArea, Integer minAge, Integer maxAge,
            Integer minFloor, Integer maxFloor, Long minDeposit, Long maxDeposit, Double nearLat,
            Double nearLng, Double nearRadiusKm) {
        this(types, commercialUses, bhks, furnishings, localities, societies, amenities, null,
                landUse, room, tenants, construction, availableFrom, pets, ownerVerified, ownershipVerified,
                rera, societyVerified, conveyanceDone, null, null, null, null,
                minArea, maxArea, null, minAge, maxAge, minFloor, maxFloor, minDeposit,
                maxDeposit, nearLat, nearLng, nearRadiusKm, null, null);
    }

    public static final ListingFacets NONE = new ListingFacets(
            null, null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null, null, null, null);

    /** Widest-first, or empty when unfiltered; kept here so the cumulative rule sits next to the field. */
    public List<String> availableFromBuckets() {
        if (availableFrom == null || availableFrom.isBlank()) {
            return List.of();
        }
        return switch (availableFrom) {
            case "now" -> List.of("now");
            case "15" -> List.of("now", "15");
            case "30" -> List.of("now", "15", "30");

            // An unknown bucket must match nothing, never everything: the CHECK admits only the
            // three buckets above, so this ordinary-looking token can never be a row's value.
            default -> List.of("no.such.bucket");
        };
    }

    /** True when a centre and a radius were both supplied, so the radius predicate can be built. */
    public boolean hasNearPoint() {
        return nearLat != null && nearLng != null && nearRadiusKm != null && nearRadiusKm > 0
                && nearLat >= -90 && nearLat <= 90 && nearLng >= -180 && nearLng <= 180;
    }

    public double effectiveRadiusKm() {
        return Math.min(nearRadiusKm, MAX_RADIUS_KM);
    }

    public static final double MAX_RADIUS_KM = 50.0;
}
