package com.draazy.api.finance.ledger;

import java.time.LocalDate;

/**
 * The window vocabulary for {@code GET /me/finances/{propId}/summary} (spec fix S18).
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1, traced to
 * the OpenAPI {@code period} parameter enum. These are the four options the Finances tab's period
 * selector has always offered.
 *
 * <p><strong>{@code YEAR} is the Indian financial year, 1 April – 31 March.</strong> Not the
 * calendar year: the reason an Indian property owner asks "what did this flat earn this year" is
 * almost always that they are filing against it, and answering with a January–December total would
 * be a number they cannot use for the one purpose they wanted it for. The mock already got this
 * right (its {@code fyStart} pivots on month index 3); the constant is named {@code year} because
 * that is what the contract and the UI's own label say.
 */
public final class SummaryPeriods {

    private SummaryPeriods() {
    }

    /** Every row ever recorded. */
    public static final String ALL = "all";

    /** From the 1st of the current calendar month. */
    public static final String MONTH = "month";

    /** From the 1st of the current calendar quarter (Jan/Apr/Jul/Oct). */
    public static final String QUARTER = "quarter";

    /** From the 1st of April of the current Indian financial year. */
    public static final String YEAR = "year";

    /** Whether {@code value} is one of the four windows. */
    public static boolean isValid(String value) {
        return ALL.equals(value)
                || MONTH.equals(value)
                || QUARTER.equals(value)
                || YEAR.equals(value);
    }

    /**
     * The inclusive lower bound of the window, or {@code null} for {@link #ALL}.
     *
     * <p>Null rather than {@code LocalDate.MIN} so the repository can express "no lower bound" as
     * a null check the planner can drop, instead of comparing every row against a sentinel date.
     *
     * @param period one of the constants above
     * @param today  the reference date
     */
    public static LocalDate startOf(String period, LocalDate today) {
        return switch (period) {
            case ALL -> null;
            case MONTH -> today.withDayOfMonth(1);
            case QUARTER -> today.withDayOfMonth(1)
                    .withMonth(((today.getMonthValue() - 1) / 3) * 3 + 1);
            // The Indian financial year: April-to-March. Before April we are still in the FY that
            // began last April.
            case YEAR -> today.getMonthValue() >= 4
                    ? LocalDate.of(today.getYear(), 4, 1)
                    : LocalDate.of(today.getYear() - 1, 4, 1);
            default -> throw new IllegalArgumentException("Unknown period: " + period);
        };
    }
}
