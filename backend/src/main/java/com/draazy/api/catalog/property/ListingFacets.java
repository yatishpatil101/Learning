package com.draazy.api.catalog.property;

import java.math.BigDecimal;
import java.util.List;

/**
 * The buyer-facing facets of the listings search; every component means "do not filter" when
 * absent. Semantics: docs/flows/consumer/search-listings.md#94-facet-semantics.
 */
public record ListingFacets(
        List<String> types,
        List<String> commercialUses,
        List<String> bhks,
        List<String> furnishings,
        List<String> localities,
        List<String> societies,
        List<String> amenities,
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
        BigDecimal minArea,
        BigDecimal maxArea,
        Integer minAge,
        Integer maxAge,
        Integer minFloor,
        Integer maxFloor,
        Double nearLat,
        Double nearLng,
        Double nearRadiusKm) {

    /**
     * The all-absent instance: filter on none of this. Used by the moderation search, which shares
     * the facet builder but offers none of these controls.
     */
    public static final ListingFacets NONE = new ListingFacets(
            null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null);

    /**
     * The move-in buckets this request accepts, widest-first, or empty when unfiltered. Kept on the
     * record so the cumulative rule is stated once, next to the field it governs.
     */
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

    /**
     * The radius to actually search, clamped to {@value #MAX_RADIUS_KM} km: an unbounded radius
     * sizes a bounding box spanning the planet, a full-table scan on an anonymous endpoint.
     */
    public double effectiveRadiusKm() {
        return Math.min(nearRadiusKm, MAX_RADIUS_KM);
    }

    /** The widest radius served. Comfortably larger than the UI's slider, and finite. */
    public static final double MAX_RADIUS_KM = 50.0;
}
