package com.draazy.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;

/** Shortlist row: the tile plus {@code available}, so a sold or rented save greys out without exposing status. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SavedCard(
        String id,
        String slug,
        String title,
        String deal,
        String propertyType,
        BigDecimal bhk,
        Long price,
        BigDecimal area,
        String locality,
        String coverImage,
        boolean available) {
}
