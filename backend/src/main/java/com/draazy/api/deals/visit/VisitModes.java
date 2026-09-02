package com.draazy.api.deals.visit;

/**
 * The visit mode vocabulary — the two values {@code visits.mode} may physically hold,
 * mirrored from the V4 CHECK constraint and the OpenAPI {@code VisitCreate.mode} enum.
 *
 * <p>Traced to both:
 * <ul>
 *   <li>V4: {@code CHECK (mode IN ('in-person','video'))}</li>
 *   <li>OpenAPI: {@code VisitCreate.mode} enum</li>
 * </ul>
 */
public final class VisitModes {

    private VisitModes() {
    }

    public static final String IN_PERSON = "in-person";
    public static final String VIDEO = "video";

    /** Validation pattern for request input. */
    public static final String PATTERN = "in-person|video";
}
