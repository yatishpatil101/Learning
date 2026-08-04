package com.punenest.api.engagement.review;

import com.punenest.api.common.trust.ReviewerStanding;

/**
 * The {@code reviews.context} vocabulary — the reviewer-standing badge the property page renders as
 * "Verified resident" or "Visited", and filters the review list on.
 *
 * <p>Server-derived and never accepted from a client (spec fix S26 marks the field
 * {@code readOnly}). A badge the caller can set is a badge that means nothing, and this one is the
 * whole basis on which a reader decides how much to believe.
 */
public final class ReviewContexts {

    private ReviewContexts() {
    }

    /** The author completed a site visit. */
    public static final String VISIT = "visit";

    /** The author holds, or once held, a tenancy on the property. */
    public static final String TENANT = "tenant";

    /**
     * Translate the trust port's answer into the stored/wire value.
     *
     * @return {@link #TENANT}, {@link #VISIT}, or {@code null} for {@link ReviewerStanding#NONE} —
     *         which callers must treat as "not eligible to review at all", never as "eligible, but
     *         without a badge"
     */
    public static String fromStanding(ReviewerStanding standing) {
        return switch (standing) {
            case TENANT -> TENANT;
            case VISITED -> VISIT;
            case NONE -> null;
        };
    }
}
