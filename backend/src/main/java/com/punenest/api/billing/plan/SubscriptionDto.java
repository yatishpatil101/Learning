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
 * @param paymentRef        the gateway order id, kept for reference and webhook correlation while
 *                          {@code status} is {@code pending}; null once nothing is owed
 * @param paymentSessionId  the single-use Cashfree session for the checkout SDK, present only in the
 *                          immediate {@code subscribe} response for a priced plan; never persisted,
 *                          so always null from {@code getSubscription}
 */
public record SubscriptionDto(
        String id,
        String planId,
        String status,
        Instant startedAt,
        Instant renewsAt,
        String paymentRef,
        String paymentSessionId) {

    /** The "no subscription" document. See the class Javadoc for why this is not a 404. */
    public static SubscriptionDto none() {
        return new SubscriptionDto(null, null, null, null, null, null, null);
    }

    /** Same document with the single-use checkout session attached (priced subscribe only). */
    public SubscriptionDto withPaymentSessionId(String sessionId) {
        return new SubscriptionDto(id, planId, status, startedAt, renewsAt, paymentRef, sessionId);
    }
}
