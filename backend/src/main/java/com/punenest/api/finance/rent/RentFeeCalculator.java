package com.punenest.api.finance.rent;

import com.punenest.api.common.settings.PlatformSettings;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.springframework.stereotype.Service;

/**
 * Computes the convenience fee and GST on a rent payment — the server-side replacement for
 * {@code lib/store/rent.js:calcRentFee} (spec fix S13).
 *
 * <p><strong>Why this moved off the client.</strong> The prototype computed the fee in the browser
 * and displayed the result, while V6's header had always said the stored fee is
 * "server-computed from platform_fees/settings, never trusted from the client". A fee the client
 * computes is a fee the client can change: open the console, halve {@code rentPayPercent}, and the
 * charge the tenant authorises no longer matches the revenue the ledger records. Even without
 * malice it is a support problem — a receipt that disagrees with the ledger by one rupee of rounding
 * is a ticket somebody has to reconcile by hand.
 *
 * <p><strong>The arithmetic mirrors the mock exactly, including the rounding order</strong>, so the
 * server's number equals the one every existing screen already shows:
 * <pre>
 *   fee = round(amount * rentPayPercent / 100)
 *   gst = round(fee    * gstPercent     / 100)
 * </pre>
 * GST is charged on the fee, not on the rent — the platform is selling a payment service, and the
 * rent itself is not a taxable supply by us. Rounding {@code fee} <em>before</em> computing GST is
 * deliberate and is what the mock does: GST is legally a tax on the invoiced fee, which is the
 * rounded figure the tenant is actually charged, not on an unrounded intermediate nobody ever sees.
 *
 * <p>Everything is whole rupees ({@link Long}), per the platform money convention.
 * {@link BigDecimal} is used for the intermediate because {@code double} cannot represent 2% of
 * ₹17,000 exactly, and money that is off by a paise is money somebody has to explain.
 */
@Service
public class RentFeeCalculator {

    private static final BigDecimal HUNDRED = new BigDecimal("100");

    private final PlatformSettings settings;

    public RentFeeCalculator(PlatformSettings settings) {
        this.settings = settings;
    }

    /**
     * The fee breakdown for a rent of {@code amountInRupees}.
     *
     * @param amountInRupees the rent itself, whole rupees, non-negative
     * @return the fee, the GST on it, and the total the tenant is charged
     */
    public Breakdown compute(long amountInRupees) {
        long amount = Math.max(0L, amountInRupees);
        long fee = applyPercent(amount, settings.rentPayPercent());
        long gst = applyPercent(fee, settings.gstPercent());
        return new Breakdown(amount, fee, gst);
    }

    /**
     * {@code round(base * percent / 100)} in whole rupees, half-up.
     *
     * <p>Half-up rather than Java's default half-even: half-even is correct for statistics and
     * wrong for invoices, because the tenant cannot see why ₹0.50 rounded down this month and up
     * the next. It is also what the mock's {@code Math.round} does, and the two must agree.
     */
    private static long applyPercent(long base, BigDecimal percent) {
        return BigDecimal.valueOf(base)
                .multiply(percent)
                .divide(HUNDRED, 0, RoundingMode.HALF_UP)
                .longValueExact();
    }

    /**
     * A computed fee breakdown, all in whole rupees.
     *
     * @param amount      the rent
     * @param platformFee the platform's convenience fee
     * @param gst         GST on {@code platformFee}
     */
    public record Breakdown(long amount, long platformFee, long gst) {

        /** What the tenant is actually charged: rent plus fee plus tax. */
        public long total() {
            return amount + platformFee + gst;
        }
    }
}
