package com.punenest.api.finance.rental;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;

/**
 * How much rent a self-declared rental has accounted for, derived from the lease dates and the
 * monthly figure.
 *
 * <p><strong>Why the server owns this arithmetic.</strong> The dashboard shows "rent paid this
 * financial year" beside an HRA exemption estimate, and the Indian financial year runs April to
 * March — a boundary that is easy to write twice and easy to write differently the second time. The
 * ledger's summary, cashflow and dues were moved server-side for exactly this reason; the same
 * argument applies here, and more sharply, because the number feeds a tax figure the tenant will
 * repeat to their employer.
 *
 * <p><strong>These are instalments due, not payments observed.</strong> Nothing here knows whether
 * the tenant actually paid — no rent moves through the platform, and this table records a lease
 * rather than a history of transfers. Counting instalments is the honest reading of what a lease
 * implies, and it is the same assumption a tenant makes when they claim twelve months of HRA. It is
 * also why none of this may reach the Rent Passport: an assumption is not a record, and a landlord
 * reading that document is entitled to the difference.
 */
final class RentalTotals {

    private RentalTotals() {
    }

    /** The Indian financial year starts on 1 April. */
    private static final int FY_START_MONTH = 4;

    /**
     * The number of rent instalments falling due on or before {@code asOf}.
     *
     * <p>Counts the dates {@code leaseStart}, {@code leaseStart + 1 month}, … that are not after
     * {@code asOf} — so a lease beginning on the 10th does not count the current month until the
     * 10th has come round. A lease that has ended stops accruing at its end date; one that has not
     * begun accrues nothing rather than a negative count.
     *
     * <p><strong>Why this is not {@code ChronoUnit.MONTHS.between}.</strong> That method clamps to
     * the shorter month, so {@code between(31 Jan, 28 Feb)} is 0 and a lease starting on the 31st
     * reported one instalment too few for the last days of every short month — self-correcting on
     * the 1st, which is what made it read as plausible rather than broken. Counting whole months
     * between the two {@link YearMonth}s and then stepping back if this month's due date has not
     * arrived yet lets {@code plusMonths} do the clamping, which is the rule the paragraph above
     * describes: an instalment due on the 31st falls due on the 28th in February.
     */
    static long monthsDue(LocalDate leaseStart, LocalDate leaseEnd, LocalDate asOf) {
        if (leaseStart == null || asOf == null) {
            return 0L;
        }
        LocalDate until = leaseEnd != null && leaseEnd.isBefore(asOf) ? leaseEnd : asOf;
        if (until.isBefore(leaseStart)) {
            return 0L;
        }
        long months = ChronoUnit.MONTHS.between(YearMonth.from(leaseStart), YearMonth.from(until));
        if (leaseStart.plusMonths(months).isAfter(until)) {
            months--;
        }
        return months + 1;
    }

    /**
     * The same count, restricted to the financial year containing {@code asOf}.
     *
     * <p>Computed as the difference of two running totals rather than by iterating months: the
     * instalments due by {@code asOf} minus those already due the day before the year began. That
     * keeps one definition of "due" instead of two, so a change to the day-of-month rule above
     * cannot leave the yearly figure disagreeing with the lifetime one.
     */
    static long monthsDueInFinancialYear(LocalDate leaseStart, LocalDate leaseEnd, LocalDate asOf) {
        if (leaseStart == null || asOf == null) {
            return 0L;
        }
        LocalDate fyStart = financialYearStart(asOf);
        return monthsDue(leaseStart, leaseEnd, asOf)
                - monthsDue(leaseStart, leaseEnd, fyStart.minusDays(1));
    }

    /** 1 April of the financial year containing {@code date}. */
    static LocalDate financialYearStart(LocalDate date) {
        int year = date.getMonthValue() >= FY_START_MONTH ? date.getYear() : date.getYear() - 1;
        return LocalDate.of(year, FY_START_MONTH, 1);
    }

    /**
     * {@code months × monthlyRent}, in whole rupees.
     *
     * <p>Both operands are {@code long} and V128 bounds the rent at one crore a month, so the
     * product cannot overflow for any lease a person could plausibly record — but the multiplication
     * is kept here rather than inlined at three call sites so that the bound and the arithmetic stay
     * next to each other.
     */
    static long total(long months, Long monthlyRent) {
        return monthlyRent == null ? 0L : months * monthlyRent;
    }
}
