package com.punenest.api.admin;

import java.time.LocalDate;

/**
 * Contract schema {@code AdminFinanceSeriesPoint} — one month of revenue, split by source.
 *
 * <p><strong>Why {@code services} is a field that is always zero.</strong> It would be shorter to
 * omit it, and that is exactly what makes omitting it wrong. The console draws three bands, and the
 * services band is the one an operator is most likely to ask about — the marketplace visibly takes
 * bookings, so a chart that simply has no services in it reads as a rendering bug rather than as a
 * statement about the business. Carrying the field and pairing it with
 * {@code AdminFinance.serviceOrdersCounted} makes the zero say what it means: the money is real to
 * the customer and the partner, and none of it moves through the platform, so
 * {@code service_orders.amount} is a quote rather than a receipt (D63/D65).
 *
 * <p>The day the marketplace settles through the gateway, this field starts carrying a number and
 * the flag flips. Nothing on either side has to be re-shaped for that to happen, which is the
 * property the always-zero field buys.
 *
 * <p><strong>{@code featured} rather than {@code boosts}.</strong> The wire uses the word the
 * product uses. The table is called {@code boosts} and the screen has always said "Featured", and
 * of the two the screen's word is the one an administrator can act on.
 *
 * @param month the first day of the bucket, in the Indian calendar — the whole month is the value,
 *     the day is only how a month is spelled as a date
 * @param subscriptions plan prices, counted when the payment reference proves an order was settled
 * @param featured boost pack prices, counted from {@code paid_at}, which only a payment webhook sets
 * @param services always zero — see above
 */
public record AdminFinanceSeriesPoint(
        LocalDate month,
        long subscriptions,
        long featured,
        long services) {

    /** The three bands added up, which is what the console's total row and its doughnut both read. */
    public long total() {
        return subscriptions + featured + services;
    }
}

