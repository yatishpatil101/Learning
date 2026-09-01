package com.punenest.api.catalog.fee;

/**
 * The statutory charges on a Maharashtra residential leave-and-licence (rent) agreement — stamp
 * duty under Article 36A of Schedule I to the Maharashtra Stamp Act, and the registration fee under
 * the Registration Act as notified for Maharashtra (D163).
 *
 * <p><strong>Why this is a calculator and not a column.</strong> {@code platform_fees} publishes one
 * flat figure per deal intent, and stamp duty on a leave-and-licence is not a flat figure: it is a
 * percentage of a consideration built from the rent, the term and the deposit, so the same document
 * costs ₹918 for one tenancy and ₹4,500 for another. Seeding <em>any</em> single number there is
 * wrong for every agreement but one, which is why the {@code rent} row now publishes nothing for
 * these two lines (V52) and this class produces the real figure per request. The published schedule
 * stays honest by declining to publish a number that does not exist.
 *
 * <p><strong>The formula</strong>, as stated by {@code docs/flows/consumer/rent-agreement.md} §5.2
 * and by the wizard's own FAQ copy:
 * <pre>
 *   years         = ceil(months / 12)
 *   consideration = rent × months + nonRefundableDeposit + 10% × refundableDeposit × years
 *   stampDuty     = round(0.25% × consideration)
 *   registration  = ₹1,000 urban (a municipal body — Pune city is one) / ₹500 rural
 * </pre>
 * The deposit enters at a notional 10% per year rather than at face value because a refundable
 * deposit is returned at the end of the term: the Act taxes the licensor's notional benefit from
 * holding it, not the sum itself. A non-refundable deposit is never returned, so it enters whole and
 * once, not per year.
 *
 * <p><strong>Arithmetic is integer throughout, in basis points.</strong> Money here is whole rupees
 * ({@code long}), per the platform convention, and {@code 0.1 * deposit} is exactly the kind of
 * intermediate that {@code double} cannot represent — a duty that is off by a paise is a duty the
 * registrar rejects and somebody reconciles by hand. The consideration is therefore carried scaled
 * by {@link #BPS} so the deposit weighting stays exact, and only the final duty is rounded, half-up,
 * once. That mirrors the wizard's rounding order exactly ({@code Math.round(0.0025 * taxable)}), so
 * the sidebar's estimate and the charge agree by construction rather than by coincidence — the
 * invariant D150 established and this change had to preserve.
 *
 * <p>Every product is {@link Math#multiplyExact}: an implausible term that would silently wrap a
 * {@code long} into a negative duty is a five-figure billing error, and failing loudly is the only
 * acceptable outcome. The plausibility bounds below are what the caller should reject on first.
 */
public final class LeaveAndLicenceCharges {

    /** One hundred percent, in basis points — the scale everything is carried in. */
    private static final long BPS = 10_000L;

    /** Stamp duty: 0.25% of the consideration (Art. 36A). */
    private static final long STAMP_DUTY_BPS = 25L;

    /** The share of the refundable deposit that enters the consideration, per year of term. */
    private static final long DEPOSIT_WEIGHT_BPS = 1_000L;

    /** Registration fee for an agreement registered with a municipal (urban) body. */
    private static final long REGISTRATION_URBAN = 1_000L;

    /** Registration fee for an agreement registered with a rural body. */
    private static final long REGISTRATION_RURAL = 500L;

    /**
     * The longest term this will price, in months.
     *
     * <p>Fifty years. Not a legal limit — it is the point past which a number is far likelier to be
     * a typo or an attack than a tenancy, and pricing it would produce a duty nobody intended.
     */
    public static final int MAX_MONTHS = 600;

    /**
     * The largest rupee figure this will accept for a rent or a deposit — ₹100 crore.
     *
     * <p>Same reasoning as {@link #MAX_MONTHS}, and together they keep the scaled consideration four
     * orders of magnitude below {@link Long#MAX_VALUE}, so the exact arithmetic below cannot be
     * pushed into an overflow by a well-formed request.
     */
    public static final long MAX_AMOUNT = 1_000_000_000L;

    private LeaveAndLicenceCharges() {
        // Static: this is arithmetic over its arguments and holds no state worth injecting.
    }

    /**
     * The terms a leave-and-licence is taxed on.
     *
     * <p>Rent and term are required and must be positive — an agreement with neither is not an
     * agreement, and taxing one at zero produces a confident ₹0 that is simply wrong. Both deposits
     * are legitimately zero: a tenancy with no deposit is common and contributes nothing to the
     * consideration, which is a real answer rather than a missing one.
     *
     * @param monthlyRentInRupees      the monthly rent, whole rupees, positive
     * @param refundableDepositInRupees the refundable security deposit, whole rupees, zero or more
     * @param nonRefundableDepositInRupees the non-refundable deposit, whole rupees, zero or more
     * @param months                   the term in months, positive, at most {@link #MAX_MONTHS}
     * @param urban                    whether the agreement registers with a municipal body
     */
    public record Terms(long monthlyRentInRupees,
            long refundableDepositInRupees,
            long nonRefundableDepositInRupees,
            int months,
            boolean urban) {

        public Terms {
            require(monthlyRentInRupees > 0 && monthlyRentInRupees <= MAX_AMOUNT, "rent");
            require(refundableDepositInRupees >= 0 && refundableDepositInRupees <= MAX_AMOUNT,
                    "deposit");
            require(nonRefundableDepositInRupees >= 0 && nonRefundableDepositInRupees <= MAX_AMOUNT,
                    "non-refundable deposit");
            require(months > 0 && months <= MAX_MONTHS, "term");
        }

        private static void require(boolean ok, String what) {
            if (!ok) {
                throw new IllegalArgumentException(
                        "Leave-and-licence " + what + " is outside the range this can be priced on");
            }
        }
    }

    /**
     * What the state charges on those terms, whole rupees.
     *
     * @param stampDuty    Art. 36A duty on the consideration
     * @param registration the flat registration fee for the registering body
     */
    public record Charges(long stampDuty, long registration) {

        /** The statutory total — what the platform collects on the state's behalf and remits. */
        public long total() {
            return stampDuty + registration;
        }
    }

    /**
     * The statutory charges on {@code terms}.
     *
     * <p>Rounding is half-up rather than Java's default half-even because half-even is right for
     * statistics and wrong for invoices, and
     * the wizard's {@code Math.round} is half-up. Both operands are non-negative here, so adding
     * half the denominator before an integer division is exactly half-up.
     */
    public static Charges on(Terms terms) {
        long rentForTerm = Math.multiplyExact(terms.monthlyRentInRupees(), (long) terms.months());
        // Carried × BPS so 10% of the deposit stays an exact integer rather than a binary fraction.
        long considerationScaled = Math.addExact(
                Math.multiplyExact(
                        Math.addExact(rentForTerm, terms.nonRefundableDepositInRupees()), BPS),
                Math.multiplyExact(
                        Math.multiplyExact(terms.refundableDepositInRupees(), years(terms.months())),
                        DEPOSIT_WEIGHT_BPS));
        long denominator = BPS * BPS;
        long numerator = Math.multiplyExact(considerationScaled, STAMP_DUTY_BPS);
        long stampDuty = (numerator + denominator / 2) / denominator;
        return new Charges(stampDuty, terms.urban() ? REGISTRATION_URBAN : REGISTRATION_RURAL);
    }

    /**
     * The term in whole years, rounded up.
     *
     * <p>Up, not to the nearest: the deposit weighting is charged for each year the licensor holds
     * the money, and an eleven-month tenancy — the overwhelmingly common Indian term, written to
     * eleven months precisely to stay outside rent-control registration — holds it for one.
     */
    private static long years(int months) {
        return (months + 11) / 12;
    }
}
