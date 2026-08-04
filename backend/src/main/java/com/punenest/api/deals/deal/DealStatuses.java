package com.punenest.api.deals.deal;

/**
 * The deal status vocabulary — the three values {@code deals.status} may physically hold,
 * mirrored from the V5 CHECK constraint and the OpenAPI {@code Deal.status} enum.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1. Every value
 * is traced to both:
 * <ul>
 *   <li>V5: {@code CHECK (status IN ('active','reserved','closed'))}</li>
 *   <li>OpenAPI: {@code Deal.status} enum</li>
 * </ul>
 *
 * <p>The transition rule is expressed in {@link #canTransition(String, String)} so that illegal
 * moves produce a clean 409, never a 500.
 */
public final class DealStatuses {

    private DealStatuses() {
    }

    /** The listing is on the market; no stored row may exist (synthesized). */
    public static final String ACTIVE = "active";

    /** The owner has marked the property under offer. */
    public static final String RESERVED = "reserved";

    /** The deal is closed (sold/rented). Terminal until explicitly reopened. */
    public static final String CLOSED = "closed";

    /**
     * Whether {@code current} may move to {@code next}. Legal transitions:
     * <ul>
     *   <li>{@code active → reserved}</li>
     *   <li>{@code active → closed} (direct close without reserving first)</li>
     *   <li>{@code reserved → closed}</li>
     *   <li>{@code reserved → active} (reopen)</li>
     *   <li>{@code closed → active} (reopen)</li>
     * </ul>
     */
    public static boolean canTransition(String current, String next) {
        if (ACTIVE.equals(current)) {
            return RESERVED.equals(next) || CLOSED.equals(next);
        }
        if (RESERVED.equals(current)) {
            return CLOSED.equals(next) || ACTIVE.equals(next);
        }
        if (CLOSED.equals(current)) {
            return ACTIVE.equals(next);
        }
        return false;
    }
}
