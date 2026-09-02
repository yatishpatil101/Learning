package com.draazy.api.common.trust;

/**
 * How a person is known to have experienced a specific listing — the evidence behind a review badge.
 *
 * <p>Ordered by strength, and the ordering is load-bearing: someone who has lived in a flat has also
 * usually visited it, so the resolver must report the strongest true standing rather than the first
 * one it happens to find.
 */
public enum ReviewerStanding {

    /** Holds, or once held, a tenancy on the listing. Renders as the "Verified resident" badge. */
    TENANT,

    /** Completed a site visit. Renders as the "Visited" badge. */
    VISITED,

    /** No completed visit and no tenancy — this person cannot review this listing. */
    NONE
}
