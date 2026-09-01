package com.draazy.api.catalog.fee;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.catalog.fee.LeaveAndLicenceCharges.Charges;
import com.draazy.api.catalog.fee.LeaveAndLicenceCharges.Terms;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The Maharashtra Art. 36A arithmetic (D163).
 *
 * <p>These are pure-arithmetic tests on purpose — no Spring, no database. The thing worth protecting
 * here is a statutory figure that a customer pays and the platform remits, and the failure modes are
 * arithmetic ones: a rounding direction, a deposit weighted once instead of per year, a term rounded
 * down, a {@code double} losing a paise. Every expected number below is stated independently of the
 * implementation so a regression cannot agree with itself.
 */
@DisplayName("Leave & License statutory charges — Maharashtra Art. 36A")
class LeaveAndLicenceChargesTest {

    @Nested
    @DisplayName("the consideration")
    class Consideration {

        /**
         * The canonical Pune tenancy: ₹32,000 a month for eleven months on a ₹1.5 lakh deposit.
         *
         * <p>consideration = 32000×11 + 0 + 10%×150000×1 = 352,000 + 15,000 = 367,000.
         * 0.25% of that is 917.5, which rounds up to 918. This case is doing double duty: it is the
         * common tenancy <em>and</em> it lands exactly on a half, so it pins the rounding direction.
         */
        @Test
        @DisplayName("rent for the term plus 10% of the refundable deposit per year")
        void canonicalElevenMonthTenancy() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(32_000L, 150_000L, 0L, 11, true));

            assertThat(charges.stampDuty()).isEqualTo(918L);
            assertThat(charges.registration()).isEqualTo(1_000L);
            assertThat(charges.total()).isEqualTo(1_918L);
        }

        /**
         * A non-refundable deposit is never returned, so it enters the consideration whole and once —
         * not at 10%, and not per year.
         *
         * <p>consideration = 352,000 + 50,000 + 15,000 = 417,000; 0.25% = 1042.5 → 1043.
         */
        @Test
        @DisplayName("a non-refundable deposit enters whole, once, not weighted and not per year")
        void nonRefundableDepositEntersWhole() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(32_000L, 150_000L, 50_000L, 11, true));

            assertThat(charges.stampDuty()).isEqualTo(1_043L);
        }

        /**
         * The refundable deposit is weighted per year of term, so a two-year tenancy counts it twice.
         *
         * <p>consideration = 20000×24 + 10%×100000×2 = 480,000 + 20,000 = 500,000; 0.25% = 1,250.
         */
        @Test
        @DisplayName("the refundable deposit is counted once per year of term")
        void depositIsWeightedPerYear() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(20_000L, 100_000L, 0L, 24, true));

            assertThat(charges.stampDuty()).isEqualTo(1_250L);
        }

        /**
         * A part year is a whole year: thirteen months holds the deposit into a second year.
         *
         * <p>consideration = 10000×13 + 10%×60000×2 = 130,000 + 12,000 = 142,000; 0.25% = 355.
         */
        @Test
        @DisplayName("a part year counts as a whole year")
        void termRoundsUpToWholeYears() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(10_000L, 60_000L, 0L, 13, true));

            assertThat(charges.stampDuty()).isEqualTo(355L);
        }

        /** A tenancy with no deposit is ordinary; it contributes a real zero, not a missing figure. */
        @Test
        @DisplayName("no deposit is a real answer, not a missing one")
        void zeroDepositIsPriced() {
            Charges charges = LeaveAndLicenceCharges.on(new Terms(25_000L, 0L, 0L, 11, true));

            // 25000 × 11 = 275,000; 0.25% = 687.5 → 688.
            assertThat(charges.stampDuty()).isEqualTo(688L);
        }

        /**
         * The paise the deposit weighting produces must survive.
         *
         * <p>10% of ₹1,50,005 is ₹15,000.50 — not representable in binary floating point. The
         * consideration is ₹3,67,000.50 and 0.25% of it is ₹917.50125, which rounds to 918. A
         * {@code double} intermediate lands on 917.5012499999… and, with the wrong rounding mode,
         * gives 917. One rupee, every agreement, in the state's favour or ours depending on the day.
         */
        @Test
        @DisplayName("a deposit that weights to half a rupee does not lose it")
        void fractionalDepositWeightIsExact() {
            Charges charges = LeaveAndLicenceCharges.on(
                    new Terms(32_000L, 150_005L, 0L, 11, true));

            assertThat(charges.stampDuty()).isEqualTo(918L);
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

        /**
         * A rent of zero is the failure this whole item is about: it produces a confident ₹0 of duty
         * for a document that attracts one, and nothing downstream can tell that apart from a real
         * answer. The type refuses to exist rather than let a caller compute it.
         */
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
        @DisplayName("a term of zero, or one longer than fifty years, is a typo not a tenancy")
        void rejectsImplausibleTerm() {
            assertThatThrownBy(() -> new Terms(32_000L, 0L, 0L, 0, true))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("term");
            assertThatThrownBy(
                    () -> new Terms(32_000L, 0L, 0L, LeaveAndLicenceCharges.MAX_MONTHS + 1, true))
                    .isInstanceOf(IllegalArgumentException.class);
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

        /**
         * The bounds exist to keep the exact arithmetic away from a {@code long} overflow. This is
         * the largest thing that can be built out of them, and it must still produce a number rather
         * than an {@code ArithmeticException} — otherwise the guard is in the wrong place.
         */
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
