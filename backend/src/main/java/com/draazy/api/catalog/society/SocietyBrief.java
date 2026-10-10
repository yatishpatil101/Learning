package com.draazy.api.catalog.society;

import java.math.BigDecimal;

/** What a listing page and the search chips show about a society; {@code avgRating} is null when unreviewed. */
public record SocietyBrief(String slug, String name, String builder, Integer units, Integer towers, Integer year,
        BigDecimal occupancy, BigDecimal avgRating, long reviewCount) {
}