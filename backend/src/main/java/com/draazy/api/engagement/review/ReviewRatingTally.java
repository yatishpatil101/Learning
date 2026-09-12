package com.draazy.api.engagement.review;

/**
 * The whole star half of a target's rating summary, as one row from one aggregate query.
 *
 * <p><strong>Why the five buckets are columns rather than a {@code group by rating}.</strong> A
 * grouped query returns only the ratings somebody actually gave, so "no two-star reviews" arrives as
 * a missing row and the caller has to zero-fill it anyway; and it cannot carry the overall average
 * alongside, which would mean a second round trip or deriving the average in Java from the counts.
 * Deriving it is what {@code D79} exists to stop — a number the server hands over must be one the
 * database computed, not one the caller reassembled and might reassemble differently.
 *
 * <p>Every component is a wrapper type because a JPQL constructor expression selects
 * {@code Long}/{@code Double}, and matching a primitive parameter would rely on unboxing during
 * constructor resolution. {@code count()} never returns null — not even over zero rows, where it
 * returns 0 — but {@code avg()} does, and that is precisely the unreviewed listing.
 *
 * @param reviewCount published reviews of this target; 0, never null
 * @param avgRating   mean rating, or {@code null} when there are no reviews to average
 */
public record ReviewRatingTally(
        Long reviewCount,
        Double avgRating,
        Long star1,
        Long star2,
        Long star3,
        Long star4,
        Long star5) {
}
