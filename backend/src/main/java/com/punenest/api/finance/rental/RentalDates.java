package com.punenest.api.finance.rental;

import com.punenest.api.common.PlatformTime;
import java.time.LocalDate;

/**
 * The bounds a self-declared lease date has to sit inside, in one place so the create and the patch
 * request cannot drift apart.
 *
 * <p><strong>Why this is restated outside the database.</strong> V128 carries
 * {@code tenant_rentals_start_sane} as a CHECK, which is the right place for the guarantee but the
 * wrong place for the message: a date below the floor reaches Postgres, raises an integrity
 * violation and comes back as 409 "conflicts with existing data". Nothing conflicts — the year is a
 * typo — and the tenant is given no field to correct. Restating the rule in Bean Validation answers
 * 422 with the field named, and leaves the CHECK doing what a CHECK is for: catching anything that
 * reaches the table by another route.
 */
final class RentalDates {

    private RentalDates() {
    }

    /** Matches V128's {@code tenant_rentals_start_sane}. */
    private static final LocalDate FLOOR = LocalDate.of(1970, 1, 1);

    /**
     * How far ahead a lease may begin. The database has no upper bound, so this one is stricter
     * than the CHECK rather than a restatement of it: someone recording the home they rent is
     * describing a tenancy they hold or are about to hold. A date beyond this is a mistyped year,
     * and letting it through would put an instalment count of zero on the dashboard with no
     * explanation of why.
     */
    private static final int MAX_YEARS_AHEAD = 2;

    /** Whether {@code date} is a plausible lease date rather than a mistyped year. */
    static boolean isSane(LocalDate date) {
        if (date == null) {
            return true;
        }
        LocalDate ceiling = LocalDate.now(PlatformTime.IST).plusYears(MAX_YEARS_AHEAD);
        return !date.isBefore(FLOOR) && !date.isAfter(ceiling);
    }
}
