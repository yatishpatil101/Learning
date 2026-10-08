package com.draazy.api.catalog.locality;

/** {@code indexable} (three or more live listings) is the only gate on indexing the page. */
public record LocalityResponse(
        String slug,
        String name,
        String city,
        Double lat,
        Double lng,
        boolean archived,
        long liveListings,
        long rentListings,
        long saleListings,
        boolean indexable,
        Long avgRent,
        Long ratePerSqft) {
}
