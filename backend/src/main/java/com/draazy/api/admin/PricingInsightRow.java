package com.draazy.api.admin;

import java.math.BigDecimal;

/** Derived figures are nullable, not {@code @JsonInclude(NON_NULL)}: an explicit null cannot be turned into a
 * market-rate fallback, which would show an unlisted locality as perfectly priced. */
public record PricingInsightRow(
        String slug,
        String name,
        Long marketRatePerSqft,
        Long avgActualRatePerSqft,
        Long avgRent,
        BigDecimal rentalYieldPct,
        long buyCount,
        long rentCount,
        long totalListings,
        Integer demand) {
}
