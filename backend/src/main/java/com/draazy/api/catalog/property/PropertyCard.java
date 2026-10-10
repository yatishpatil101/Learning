package com.draazy.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;

/** Photo tile for home and dashboard rails: only what it draws. The grid reads {@link PropertySummary}. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PropertyCard(
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
        boolean ownerVerified,
        boolean ownershipVerified) {
}
