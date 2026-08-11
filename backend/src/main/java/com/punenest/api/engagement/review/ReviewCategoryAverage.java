package com.punenest.api.engagement.review;

import java.math.BigDecimal;

/**
 * One aspect's mean sub-rating, straight out of the {@code categories} JSONB column.
 *
 * <p>An interface projection rather than a record because the query behind it is native — the
 * average is taken over {@code jsonb_each} of a document column, which JPQL cannot express — and a
 * native query binds a projection by column alias. The aliases are {@code category} and
 * {@code average}, matching these getters exactly.
 *
 * <p>Sparse by construction: an aspect nobody rated produces no row at all, which is the same
 * contract {@code Review.categories} already has. Averaging an aspect over the reviews that answered
 * it — rather than over every review — is what the property page was already doing client-side, and
 * silently changing that denominator would move every displayed number.
 */
public interface ReviewCategoryAverage {

    /** One of {@link ReviewCategories#KEYS}; the query filters to that closed set. */
    String getCategory();

    /** Mean of the 1–5 answers for this aspect, at full precision; the service rounds it. */
    BigDecimal getAverage();
}
