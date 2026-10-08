package com.draazy.api.admin;

import java.math.BigDecimal;

/** Derived figures are nullable on purpose: null is a measurement that was not possible, rendered as "no data", never zero. */
public record PricingInsightRow(
        String slug,
        String name,
        Long avgActualRatePerSqft,
        Long avgRent,
        BigDecimal rentalYieldPct,
        long buyCount,
        long rentCount,
        long totalListings) {
}