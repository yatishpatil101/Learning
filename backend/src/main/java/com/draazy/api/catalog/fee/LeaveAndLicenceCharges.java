package com.draazy.api.catalog.fee;

/** Stamp duty depends on rent, term and deposit, so no single platform fee can be seeded. */
public final class LeaveAndLicenceCharges {

    private static final long BPS = 10_000L;

    private static final long STAMP_DUTY_BPS = 25L;

    private static final long DEPOSIT_WEIGHT_BPS = 1_000L;

    private static final long REGISTRATION_URBAN = 1_000L;

    private static final long REGISTRATION_RURAL = 500L;

    private static final long DUTY_STEP = 100L;

    public static final long HANDLING_CHARGE = 300L;

    /** Past sixty months this becomes a lease with different duty; pricing it here would be wrong. */
    public static final int MAX_MONTHS = 60;

    /** A ₹100 crore cap rejects typos/attacks and keeps exact arithmetic below {@link Long#MAX_VALUE}. */
    public static final long MAX_AMOUNT = 1_000_000_000L;

    private LeaveAndLicenceCharges() {
    }

    /** Rent and term must be positive; zero deposits are valid and add nothing. */
    public record Terms(long monthlyRentInRupees,
            long refundableDepositInRupees,
            long nonRefundableDepositInRupees,
            int months,
            boolean urban,
            int incrementBps,
            int incrementEveryMonths) {

        public Terms {
            require(monthlyRentInRupees > 0 && monthlyRentInRupees <= MAX_AMOUNT, "rent");
            require(refundableDepositInRupees >= 0 && refundableDepositInRupees <= MAX_AMOUNT,
                    "deposit");
            require(nonRefundableDepositInRupees >= 0 && nonRefundableDepositInRupees <= MAX_AMOUNT,
                    "non-refundable deposit");
            require(months > 0 && months <= MAX_MONTHS, "term");
            require(incrementBps >= 0 && incrementBps <= BPS, "increment");
            require(incrementEveryMonths == 11 || incrementEveryMonths == 12, "increment interval");
        }

        public Terms(long monthlyRentInRupees, long refundableDepositInRupees,
                long nonRefundableDepositInRupees, int months, boolean urban) {
            this(monthlyRentInRupees, refundableDepositInRupees, nonRefundableDepositInRupees,
                    months, urban, 0, 11);
        }

        private static void require(boolean ok, String what) {
            if (!ok) {
                throw new IllegalArgumentException(
                        "Leave-and-licence " + what + " is outside the range this can be priced on");
            }
        }
    }

    public record Charges(long exactDuty, long stampDuty, long registration, long handling) {

        public long total() {
            return stampDuty + registration + handling;
        }
    }

    /** Use half-up rounding to match the wizard's {@code Math.round}; operands are non-negative. */
    public static Charges on(Terms terms) {
        long rentForTerm = rentForTerm(terms);

        // Carried × BPS so 10% of the deposit stays an exact integer rather than a binary fraction.
        long considerationScaled = Math.addExact(
                Math.multiplyExact(
                        Math.addExact(rentForTerm, terms.nonRefundableDepositInRupees()), BPS),
                Math.multiplyExact(
                        Math.multiplyExact(terms.refundableDepositInRupees(), years(terms.months())),
                        DEPOSIT_WEIGHT_BPS));
        long denominator = BPS * BPS;
        long numerator = Math.multiplyExact(considerationScaled, STAMP_DUTY_BPS);
        long exactDuty = (numerator + denominator / 2) / denominator;

        long stampDuty = Math.max(DUTY_STEP,
                Math.ceilDiv(numerator, Math.multiplyExact(denominator, DUTY_STEP)) * DUTY_STEP);
        return new Charges(exactDuty, stampDuty,
                terms.urban() ? REGISTRATION_URBAN : REGISTRATION_RURAL, HANDLING_CHARGE);
    }

    private static long rentForTerm(Terms terms) {
        long rent = terms.monthlyRentInRupees();
        long total = 0L;
        for (int paid = 0; paid < terms.months(); paid += terms.incrementEveryMonths()) {
            if (paid > 0) {
                rent = (Math.multiplyExact(rent, BPS + terms.incrementBps()) + BPS / 2) / BPS;
            }
            int block = Math.min(terms.incrementEveryMonths(), terms.months() - paid);
            total = Math.addExact(total, Math.multiplyExact(rent, (long) block));
        }
        return total;
    }

    /** Round up: even the common eleven-month term holds the deposit for one chargeable year. */
    private static long years(int months) {
        return (months + 11) / 12;
    }
}
