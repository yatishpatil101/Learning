package com.draazy.api.common.error;

/**
 * 409 — this account has already reviewed this target.
 *
 * <p>One voice, one review. An average that a single account can move fifty times is not an average
 * of anything, and it is the cheapest possible attack on a marketplace's trust surface: no money, no
 * second identity, just a loop.
 *
 * <p>Raised from a pre-check so the ordinary case (a user revisiting a page they already reviewed)
 * gets a clean, explicable answer. The <em>guarantee</em>, though, comes from
 * {@code idx_reviews_author_target} in V16 — two concurrent submits both pass any service-level
 * check before either commits, so a check alone would be a rule that holds only while nobody is
 * trying (the slice-3 / V9 lesson).
 */
public class AlreadyReviewedException extends ApiException {

    public AlreadyReviewedException(String message) {
        super(ErrorCodes.ALREADY_REVIEWED, 409, message);
    }
}
