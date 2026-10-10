package com.draazy.api.catalog.society;

import java.math.BigDecimal;
import java.util.UUID;

/** {@code id} binds a listing to the society in the wizard. */
public record SocietyResponse(
        UUID id,
        String slug,
        String name,
        String builder,
        String localitySlug,
        Double lat,
        Double lng,
        Integer year,
        String rera,
        long listingCount,
        BigDecimal avgRating,
        long reviewCount) {
}