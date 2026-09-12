package com.draazy.api.engagement.review;

import java.math.BigDecimal;
import java.util.Map;

/**
 * The contract's {@code ReviewSummary} — the three numbers a listing page puts next to its stars,
 * computed once by the database instead of five times by whoever is reading the list.
 *
 * <p><strong>Why this exists (D79).</strong> {@code GET /properties/&#123;propId&#125;/reviews} is
 * unpaged by ruling D8.6, and the reason it may stay unpaged is that the property page derives the
 * average, the star distribution and the per-aspect averages from the full array. That is a real
 * bound, but it makes three visible numbers hostage to the list staying whole: page it — ever, for
 * any reason — and the page would keep rendering them, now silently describing page one. This
 * endpoint removes that coupling without changing the list, so paging becomes a decision rather
 * than a regression.
 *
 * <p>{@code avgRating} is null, not 0, on an unreviewed listing, matching {@code Society.avgRating}:
 * no rating is not a rating of zero, and a star strip rendering 0.0 states something false about a
 * listing nobody has reviewed yet. {@code reviewCount} is a plain 0 in that case, because "how many"
 * always has an answer.
 *
 * @param avgRating        mean published rating to one decimal, as the UI renders it; null when
 *                         {@code reviewCount} is 0
 * @param reviewCount      published reviews this summary is over — 4.9 from one review is not 4.9
 *                         from two hundred
 * @param distribution     counts keyed {@code "1"}–{@code "5"}, always all five keys and zero-filled,
 *                         so the bar chart needs no guard per bucket
 * @param categoryAverages mean per-aspect sub-rating, each to one decimal, over only the reviews
 *                         that answered that aspect; sparse and empty rather than null
 */
public record ReviewSummaryResponse(
        BigDecimal avgRating,
        long reviewCount,
        Map<String, Long> distribution,
        Map<String, BigDecimal> categoryAverages) {
}
