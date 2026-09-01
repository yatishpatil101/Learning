package com.draazy.api.finance.ledger;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for the recurrence projection.
 *
 * <p>A plain unit test, not a {@code @SpringBootTest}: {@link RecurringIntervals} is pure date
 * arithmetic with no collaborators, and the date rules it encodes are exactly the kind that break
 * silently at a month boundary six months after anyone last looked at them.
 */
class RecurringIntervalsTest {

    @Test
    @DisplayName("month-end rent stays at month-end after passing through February")
    void monthEndDoesNotDriftAfterFebruary() {
        // The regression this class exists for. Stepping iteratively (next = next.plusMonths(1))
        // clamps 31 Jan to 29 Feb and then keeps the 29th for good: 29 Mar, 29 Apr, 29 May. An
        // owner whose rent falls due on the last day of the month would see it silently move two
        // days earlier, permanently, after one leap February.
        LocalDate anchor = LocalDate.of(2024, 1, 31);

        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.MONTHLY, LocalDate.of(2024, 2, 1)))
                .isEqualTo(LocalDate.of(2024, 2, 29));
        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.MONTHLY, LocalDate.of(2024, 3, 1)))
                .isEqualTo(LocalDate.of(2024, 3, 31));
        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.MONTHLY, LocalDate.of(2024, 4, 1)))
                .isEqualTo(LocalDate.of(2024, 4, 30));
        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.MONTHLY, LocalDate.of(2024, 5, 1)))
                .isEqualTo(LocalDate.of(2024, 5, 31));
    }

    @Test
    @DisplayName("a 29 February anchor returns to the 29th in the next leap year")
    void leapDayAnchorRecoversInTheNextLeapYear() {
        LocalDate anchor = LocalDate.of(2024, 2, 29);

        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.YEARLY, LocalDate.of(2025, 1, 1)))
                .isEqualTo(LocalDate.of(2025, 2, 28));
        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.YEARLY, LocalDate.of(2028, 1, 1)))
                .isEqualTo(LocalDate.of(2028, 2, 29));
    }

    @Test
    @DisplayName("the common case: rent on the 5th stays on the 5th")
    void midMonthDayIsPreserved() {
        LocalDate anchor = LocalDate.of(2024, 1, 5);

        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.MONTHLY, LocalDate.of(2025, 6, 20)))
                .isEqualTo(LocalDate.of(2025, 7, 5));
    }

    @Test
    @DisplayName("quarterly and yearly step by whole periods from the anchor")
    void quarterlyAndYearlyStepFromTheAnchor() {
        LocalDate anchor = LocalDate.of(2024, 1, 31);

        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.QUARTERLY, LocalDate.of(2024, 5, 1)))
                .isEqualTo(LocalDate.of(2024, 7, 31));
        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.YEARLY, LocalDate.of(2024, 5, 1)))
                .isEqualTo(LocalDate.of(2025, 1, 31));
    }

    @Test
    @DisplayName("the due date on the anchor day is the anchor day, not a period later")
    void anchorOnOrAfterTodayIsReturnedUnchanged() {
        LocalDate anchor = LocalDate.of(2024, 6, 10);

        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.MONTHLY, anchor))
                .isEqualTo(anchor);
        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.MONTHLY, LocalDate.of(2024, 6, 1)))
                .isEqualTo(anchor);
    }

    @Test
    @DisplayName("a one-off row is never due again")
    void nonRepeatingIntervalsProjectToNull() {
        LocalDate anchor = LocalDate.of(2024, 1, 31);

        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                anchor, RecurringIntervals.NONE, LocalDate.of(2024, 5, 1))).isNull();
        assertThat(RecurringIntervals.nextOccurrenceOnOrAfter(
                null, RecurringIntervals.MONTHLY, LocalDate.of(2024, 5, 1))).isNull();
    }
}
