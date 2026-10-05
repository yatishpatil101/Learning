package com.draazy.api.catalog.fee;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.catalog.fee.LeaveAndLicenceCharges.Charges;
import com.draazy.api.catalog.fee.LeaveAndLicenceCharges.Terms;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

// These expected amounts are independent of the implementation so arithmetic regressions
// cannot agree with themselves on statutory charges customers pay and the platform remits.
@DisplayName("Leave & License statutory charges — Maharashtra Art. 36A")
class LeaveAndLicenceChargesTest {

    @Nested
    @DisplayName("the consideration")
    class Consideration {

        // 0.25% of that is 917.5, which rounds up to 918.
        // Common tenancy that lands exactly on a half, so it pins rounding direction.
        @Test
        @DisplayName("rent for the term plus 10% of the refundable deposit per year")
        void canonicalElevenMonthTenancy() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(32_000L, 150_000L, 0L, 11, true));

            assertThat(charges.exactDuty()).isEqualTo(918L);
            assertThat(charges.registration()).isEqualTo(1_000L);
            assertThat(charges.stampDuty()).isEqualTo(1_000L);
            assertThat(charges.handling()).isEqualTo(300L);
            assertThat(charges.total()).isEqualTo(2_300L);
        }

        // A non-refundable deposit is never returned, so it enters whole and once.
        @Test
        @DisplayName("a non-refundable deposit enters whole, once, not weighted and not per year")
        void nonRefundableDepositEntersWhole() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(32_000L, 150_000L, 50_000L, 11, true));

            assertThat(charges.exactDuty()).isEqualTo(1_043L);
        }

        // The refundable deposit is weighted per year of term, so a two-year tenancy counts it twice.
        @Test
        @DisplayName("the refundable deposit is counted once per year of term")
        void depositIsWeightedPerYear() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(20_000L, 100_000L, 0L, 24, true));

            assertThat(charges.exactDuty()).isEqualTo(1_250L);
        }

        // A part year is a whole year: thirteen months holds the deposit into a second year.
        @Test
        @DisplayName("a part year counts as a whole year")
        void termRoundsUpToWholeYears() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(10_000L, 60_000L, 0L, 13, true));

            assertThat(charges.exactDuty()).isEqualTo(355L);
        }

        @Test
        @DisplayName("no deposit is a real answer, not a missing one")
        void zeroDepositIsPriced() {
            Charges charges = LeaveAndLicenceCharges.on(new Terms(25_000L, 0L, 0L, 11, true));

            assertThat(charges.exactDuty()).isEqualTo(688L);
        }

        // The paise the deposit weighting produces must survive.
        // The consideration is ?3,67,000.50 and 0.25% of it is ?917.50125, which rounds to 918.
        @Test
        @DisplayName("a deposit that weights to half a rupee does not lose it")
        void fractionalDepositWeightIsExact() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(32_000L, 150_005L, 0L, 11, true));

            assertThat(charges.exactDuty()).isEqualTo(918L);
        }
    }

    @Nested
    @DisplayName("rent escalation")
    class Escalation {

        @Test
        @DisplayName("an increase every eleven months taxes the escalated rent for the months it runs")
        void elevenMonthEscalation() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(20_000L, 100_000L, 0L, 22, true, 500, 11));

            assertThat(charges.exactDuty()).isEqualTo(1_178L);
        }

        @Test
        @DisplayName("an increase every twelve months")
        void twelveMonthEscalation() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(20_000L, 100_000L, 0L, 24, true, 500, 12));

            assertThat(charges.exactDuty()).isEqualTo(1_280L);
        }

        @Test
        @DisplayName("a part block after the first escalation is taxed at the escalated rent")
        void partBlockIsEscalated() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(32_000L, 150_000L, 0L, 12, true, 500, 11));

            assertThat(charges.exactDuty()).isEqualTo(1_002L);
        }

        @Test
        @DisplayName("each increase compounds on the rent it replaces")
        void escalationCompounds() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(10_000L, 0L, 0L, 36, true, 1_000, 12));

            assertThat(charges.exactDuty()).isEqualTo(993L);
        }

        @Test
        @DisplayName("the escalated rent is the whole-rupee figure the deed states, rounded half-up")
        void escalatedRentIsWholeRupees() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(11_130L, 0L, 0L, 24, true, 500, 12));

            assertThat(charges.exactDuty()).isEqualTo(685L);
        }

        @Test
        @DisplayName("a fractional percentage is carried exactly in basis points")
        void fractionalPercentage() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(20_000L, 0L, 0L, 24, true, 250, 12));

            assertThat(charges.exactDuty()).isEqualTo(1_215L);
        }

        @Test
        @DisplayName("a term that ends before the first increase is taxed on the flat rent")
        void termWithinFirstBlockIsFlat() {
            assertThat(LeaveAndLicenceCharges.on(new Terms(32_000L, 150_000L, 0L, 11, true, 500, 11))
                    .exactDuty()).isEqualTo(918L);
            assertThat(LeaveAndLicenceCharges.on(new Terms(32_000L, 150_000L, 0L, 12, true, 500, 12))
                    .exactDuty()).isEqualTo(LeaveAndLicenceCharges.on(
                            new Terms(32_000L, 150_000L, 0L, 12, true)).exactDuty());
        }

        @Test
        @DisplayName("an increase outside 0–100%, or an interval other than 11 or 12 months, is refused")
        void rejectsImplausibleEscalation() {
            assertThatThrownBy(() -> new Terms(20_000L, 0L, 0L, 24, true, -1, 12))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("increment");
            assertThatThrownBy(() -> new Terms(20_000L, 0L, 0L, 24, true, 10_001, 12))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> new Terms(20_000L, 0L, 0L, 24, true, 500, 6))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("increment interval");
        }

        @Test
        @DisplayName("the steepest priceable escalation still computes rather than overflowing")
        void extremeEscalationDoesNotOverflow() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(LeaveAndLicenceCharges.MAX_AMOUNT, LeaveAndLicenceCharges.MAX_AMOUNT,
                            LeaveAndLicenceCharges.MAX_AMOUNT, LeaveAndLicenceCharges.MAX_MONTHS,
                            true, 10_000, 11));

            assertThat(charges.stampDuty()).isPositive();
        }
    }

    @Nested
    @DisplayName("the duty GRAS collects (D-a)")
    class IgrRounding {

        @Test
        @DisplayName("a duty already in whole hundreds is billed as it is")
        void wholeHundredStays() {
            Charges charges = LeaveAndLicenceCharges.on(new Terms(3_000L, 70_000L, 0L, 11, true));

            assertThat(charges.exactDuty()).isEqualTo(100L);
            assertThat(charges.stampDuty()).isEqualTo(100L);
        }

        @Test
        @DisplayName("a paisa past a hundred bills the next hundred")
        void aPaisaPastRoundsUp() {
            Charges charges = LeaveAndLicenceCharges.on(new Terms(3_000L, 70_040L, 0L, 11, true));

            assertThat(charges.exactDuty()).isEqualTo(100L);
            assertThat(charges.stampDuty()).isEqualTo(200L);
        }

        @Test
        @DisplayName("a duty under ₹100 bills the ₹100 minimum")
        void floorIsAHundred() {
            Charges charges = LeaveAndLicenceCharges.on(new Terms(1_000L, 0L, 0L, 11, true));

            assertThat(charges.exactDuty()).isEqualTo(28L);
            assertThat(charges.stampDuty()).isEqualTo(100L);
        }

        @Test
        @DisplayName("the ₹300 handling charge is its own line, urban or rural")
        void handlingIsItsOwnLine() {
            Charges rural = LeaveAndLicenceCharges.on(new Terms(32_000L, 150_000L, 0L, 11, false));

            assertThat(rural.handling()).isEqualTo(300L);
            assertThat(rural.total()).isEqualTo(1_000L + 500L + 300L);
        }
    }

    @Nested
    @DisplayName("the registration fee")
    class Registration {

        @Test
        @DisplayName("₹1,000 for a municipal body — Pune city is one")
        void urbanIsAThousand() {
            assertThat(LeaveAndLicenceCharges.on(new Terms(32_000L, 150_000L, 0L, 11, true))
                    .registration()).isEqualTo(1_000L);
        }

        @Test
        @DisplayName("₹500 for a rural body, and the duty is unaffected by which")
        void ruralIsFiveHundred() {
            Charges urban = LeaveAndLicenceCharges.on(new Terms(32_000L, 150_000L, 0L, 11, true));
            Charges rural = LeaveAndLicenceCharges.on(new Terms(32_000L, 150_000L, 0L, 11, false));

            assertThat(rural.registration()).isEqualTo(500L);
            assertThat(rural.stampDuty()).isEqualTo(urban.stampDuty());
        }
    }

    @Nested
    @DisplayName("terms it refuses to price")
    class Refusals {

        // Zero rent would produce a confident ₹0 duty for a chargeable document.
        // Nothing downstream can distinguish that from a real answer.
        @Test
        @DisplayName("a rent of zero or less is not a tenancy")
        void rejectsNonPositiveRent() {
            assertThatThrownBy(() -> new Terms(0L, 150_000L, 0L, 11, true))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("rent");
            assertThatThrownBy(() -> new Terms(-1L, 150_000L, 0L, 11, true))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        @DisplayName("a term of zero, or one past the five years Art. 36A covers, is not a leave and licence")
        void rejectsImplausibleTerm() {
            assertThatThrownBy(() -> new Terms(32_000L, 0L, 0L, 0, true))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("term");
            assertThatThrownBy(
                    () -> new Terms(32_000L, 0L, 0L, LeaveAndLicenceCharges.MAX_MONTHS + 1, true))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThat(LeaveAndLicenceCharges.MAX_MONTHS).isEqualTo(60);
        }

        @Test
        @DisplayName("a negative deposit is refused rather than clamped")
        void rejectsNegativeDeposit() {
            assertThatThrownBy(() -> new Terms(32_000L, -1L, 0L, 11, true))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("deposit");
            assertThatThrownBy(() -> new Terms(32_000L, 0L, -1L, 11, true))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        // The largest allowed inputs must produce a number, not an overflow.
        @Test
        @DisplayName("the largest priceable tenancy still computes rather than overflowing")
        void extremeButPriceableTermsDoNotOverflow() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(LeaveAndLicenceCharges.MAX_AMOUNT, LeaveAndLicenceCharges.MAX_AMOUNT,
                            LeaveAndLicenceCharges.MAX_AMOUNT, LeaveAndLicenceCharges.MAX_MONTHS,
                            true));

            assertThat(charges.stampDuty()).isPositive();
        }
    }
}
