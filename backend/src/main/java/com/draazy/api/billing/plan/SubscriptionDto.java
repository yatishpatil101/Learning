package com.draazy.api.billing.plan;

/** Every field is nullable: {@link #none()} gives a never-subscribed caller an empty document, not a 404.
 * {@code paymentSessionId} is single-use, only in the subscribe response and never persisted. */
public record SubscriptionDto(
        String id,
        String planId,
        String status,
        String paymentRef,
        String paymentSessionId) {

    /** The "no subscription" document. See the class Javadoc for why this is not a 404. */
    public static SubscriptionDto none() {
        return new SubscriptionDto(null, null, null, null, null);
    }

    /** Same document with the single-use checkout session attached (priced subscribe only). */
    public SubscriptionDto withPaymentSessionId(String sessionId) {
        return new SubscriptionDto(id, planId, status, paymentRef, sessionId);
    }
}
