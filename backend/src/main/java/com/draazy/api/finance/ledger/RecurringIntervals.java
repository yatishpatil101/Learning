package com.draazy.api.finance.ledger;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/**
 * The recurrence vocabulary for a ledger row, and the rule that projects one forward to its next
 * occurrence.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1. Every value
 * is traced to:
 * <ul>
 *   <li>V6: {@code CHECK (recurring IN ('none','monthly','quarterly','yearly'))}</li>
 *   <li>OpenAPI: {@code Transaction.recurring} enum</li>
 * </ul>
 *
 * <p><strong>Named {@code recurring}, not {@code repeat}.</strong> The frontend mock calls this
 * field {@code repeat}; V6 recorded the decision to standardise on {@code recurring} and the
 * contract follows. The frontend adapter renames it — the server does not carry two names for one
 * fact.
 *
 * <p><strong>Why the projection lives here.</strong> {@link #nextOccurrenceOnOrAfter} is the single
 * definition of "when is this next due", used by the dues endpoint. The mock recomputes it in the
 * browser; once the server answers, two implementations of a date rule would drift, and the one the
 * owner sees would depend on which screen they were on.
 */
public final class RecurringIntervals {

    private RecurringIntervals() {
    }

    /** A one-off row. Never appears in dues. */
    public static final String NONE = "none";

    /** Due the same day each month — rent, EMI, society maintenance. */
    public static final String MONTHLY = "monthly";

    /** Due every three months — some society charges, advance tax. */
    public static final String QUARTERLY = "quarterly";

    /** Due once a year — property tax, insurance. */
    public static final String YEARLY = "yearly";

    /** Whether {@code value} is one of the four stored intervals. */
    public static boolean isValid(String value) {
        return NONE.equals(value)
                || MONTHLY.equals(value)
                || QUARTERLY.equals(value)
                || YEARLY.equals(value);
    }

    /** Whether this interval repeats at all — i.e. whether it can ever be due again. */
    public static boolean repeats(String value) {
        return isValid(value) && !NONE.equals(value);
    }

    /**
     * The first occurrence of {@code anchor} at this interval that falls on or after {@code today}.
     *
     * <p>Stepping by calendar units rather than by a fixed number of days is deliberate: a rent due
     * on the 5th is due on the 5th, not 30 days after the last one, and a fixed-day step would walk
     * the due date backwards through the month over a year. {@link LocalDate#plusMonths} also
     * handles the case a day-count cannot: an anchor on the 31st resolves to the 30th, or to the
     * 28th/29th in February, rather than overflowing into the next month.
     *
     * <p><strong>Every step is measured from the anchor, never from the previous step.</strong>
     * That distinction is the whole correctness of this method. Stepping iteratively
     * ({@code next = next.plusMonths(1)}) clamps once and then keeps the clamped day forever: rent
     * due on the 31st becomes 29 Feb, then 29 Mar, 29 Apr, and never returns to month-end. Because
     * {@code plusMonths} clamps relative to the day-of-month of the date it is called on, only
     * {@code anchor.plusMonths(n)} re-derives the 31st in every month that has one. Month-end rent
     * is common enough in Pune leases that a two-day drift would show up as a real dispute.
     *
     * <p>An anchor in the future is returned unchanged — a transaction dated next week is next due
     * next week, not a period later.
     *
     * @param anchor   the transaction's own date, i.e. the last known occurrence
     * @param interval one of the constants above
     * @param today    the reference date
     * @return the next occurrence, or {@code null} if the interval does not repeat
     */
    public static LocalDate nextOccurrenceOnOrAfter(LocalDate anchor, String interval,
                                                    LocalDate today) {
        if (anchor == null || !repeats(interval)) {
            return null;
        }
        if (!anchor.isBefore(today)) {
            return anchor;
        }
        // Jump straight to roughly the right period, then correct. Both the estimate and the
        // correction step from `anchor`, so the day-of-month is re-derived every time.
        int monthsPerPeriod = switch (interval) {
            case MONTHLY -> 1;
            case QUARTERLY -> 3;
            case YEARLY -> 12;
            default -> throw new IllegalStateException("Unreachable: " + interval);
        };
        long periods = ChronoUnit.MONTHS.between(anchor, today) / monthsPerPeriod;
        LocalDate next = anchor.plusMonths(periods * monthsPerPeriod);
        while (next.isBefore(today)) {
            periods++;
            next = anchor.plusMonths(periods * monthsPerPeriod);
        }
        return next;
    }
}
