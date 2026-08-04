package com.punenest.api.billing.plan;

import java.time.Instant;

/**
 * Contract {@code Subscription} (spec fix S50).
 *
 * <p>Every field is nullable because of {@link #none()}: {@code getSubscription} declares only a
 * {@code 200}, so a caller who has never subscribed gets an empty document rather than a 404. This
 * follows {@code RentMandateDto.none()} — the plan screen renders "you are on the free tier" from an
 * empty object far more naturally than from an error it has to catch.
 *
 * @param paymentRef the gateway order id to hand to the checkout SDK while {@code status} is
 *                   {@code pending}; null once nothing is owed
 */
public record SubscriptionDto(
        String id,
        String planId,
        String status,
        Instant startedAt,
        Instant renewsAt,
        String paymentRef) {

    /** The "no subscription" document. See the class Javadoc for why this is not a 404. */
    public static SubscriptionDto none() {
        return new SubscriptionDto(null, null, null, null, null, null);
    }
}
