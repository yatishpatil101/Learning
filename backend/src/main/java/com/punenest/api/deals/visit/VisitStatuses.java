package com.punenest.api.deals.visit;

/**
 * The visit status vocabulary — the five values {@code visits.status} may physically hold,
 * mirrored from the V4 CHECK constraint and the OpenAPI {@code Visit.status} enum.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1. Every value
 * is traced to both:
 * <ul>
 *   <li>V4: {@code CHECK (status IN ('scheduled','confirmed','completed','cancelled','no-show'))}</li>
 *   <li>OpenAPI: {@code Visit.status} enum</li>
 * </ul>
 *
 * <p>The transition rule is expressed in {@link #canTransition(String, String)} so that illegal
 * moves produce a clean 409, never a 500.
 *
 * <p><strong>Role-split transitions (D3, security-critical).</strong> The owner may set any
 * non-initial status ({@code confirmed}, {@code completed}, {@code no-show}, {@code cancelled}).
 * The visitor may ONLY set {@code cancelled}. A visitor marking their own visit {@code completed}
 * would forge the anti-fake-review signal ({@code hasCompletedVisit} gates the "Visited" review
 * badge — reconciliation item f). This is enforced in the service, not in the state machine;
 * the machine answers "is this move legal at all?" while the service answers "may THIS caller
 * make it?".
 */
public final class VisitStatuses {

    private VisitStatuses() {
    }

    /** The visitor has booked; awaiting the owner's confirmation. Initial status on create. */
    public static final String SCHEDULED = "scheduled";

    /** The owner confirmed the visit. */
    public static final String CONFIRMED = "confirmed";

    /** The owner marked the visit as completed. Gates the "Visited" review badge. */
    public static final String COMPLETED = "completed";

    /** Either party cancelled. Terminal. */
    public static final String CANCELLED = "cancelled";

    /** The owner marked the visitor as a no-show. Terminal. */
    public static final String NO_SHOW = "no-show";

    /**
     * Whether {@code current} may move to {@code next}. Legal transitions:
     * <ul>
     *   <li>{@code scheduled → confirmed|cancelled}</li>
     *   <li>{@code confirmed → completed|cancelled|no-show}</li>
     * </ul>
     * All of {@code completed}, {@code cancelled}, and {@code no-show} are terminal.
     */
    public static boolean canTransition(String current, String next) {
        if (SCHEDULED.equals(current)) {
            return CONFIRMED.equals(next) || CANCELLED.equals(next);
        }
        if (CONFIRMED.equals(current)) {
            return COMPLETED.equals(next) || CANCELLED.equals(next) || NO_SHOW.equals(next);
        }
        return false;
    }
}
