package com.draazy.api.engagement.review;

import java.math.BigDecimal;
import java.util.Map;

/** {@code avgRating} is null, not 0, on an unreviewed listing: no rating is not a rating of zero. */
public record ReviewSummaryResponse(
        BigDecimal avgRating,
        long reviewCount,
        Map<String, Long> distribution,
        Map<String, BigDecimal> categoryAverages) {
}
