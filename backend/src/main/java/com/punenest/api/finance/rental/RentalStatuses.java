package com.punenest.api.finance.rental;

import java.util.Set;

/**
 * The status vocabulary for a self-declared rental.
 *
 * <p>{@code String} constants rather than an {@code enum}, per {@code api-standards.md} §7.1. Both
 * values are traced to V128's {@code CHECK (status IN ('active', 'ended'))} and to the contract's
 * {@code TenantRental.status} enum.
 *
 * <p><strong>Why "ended" is not "deleted".</strong> A tenant who moves out in March still needs the
 * rent they paid that financial year, and March is exactly when they need it. Ending a rental takes
 * it off the dashboard's active card without taking it out of the year's totals.
 */
public final class RentalStatuses {

    private RentalStatuses() {
    }

    /** The tenant currently lives there. */
    public static final String ACTIVE = "active";

    /** They moved out. The row still counts toward past financial years. */
    public static final String ENDED = "ended";

    private static final Set<String> ALL = Set.of(ACTIVE, ENDED);

    /** Whether {@code value} is one of the two recognised statuses. */
    public static boolean isValid(String value) {
        return value != null && ALL.contains(value);
    }
}
