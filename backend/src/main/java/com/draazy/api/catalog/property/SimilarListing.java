package com.draazy.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;

/** A "similar homes" card; {@code distanceKm} is absent when either listing has no pin. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SimilarListing(
        String id,
        String slug,
        String title,
        String deal,
        String propertyType,
        BigDecimal bhk,
        Long price,
        BigDecimal area,
        String locality,
        String city,
        String coverImage,
        String reraId,
        boolean ownerVerified,
        Double distanceKm) {
}
