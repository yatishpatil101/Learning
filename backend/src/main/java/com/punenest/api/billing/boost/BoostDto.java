package com.punenest.api.billing.boost;

import java.time.Instant;

/**
 * Contract {@code Boost} (spec fix S51).
 *
 * @param startsAt   null until the payment webhook confirms — the window is dated from the money
 * @param paymentRef the gateway order id to hand to the checkout SDK while {@code status} is
 *                   {@code pending}; null on a free pack
 * @param paymentSessionId the single-use Cashfree session for the checkout SDK, present only in the
 *                   immediate {@code boostListing} response for a priced pack; never persisted, so
 *                   always null from {@code listListingBoosts} (D167)
 */
public record BoostDto(
        String id,
        String propertyId,
        String packId,
        Instant startsAt,
        Instant endsAt,
        String status,
        String paymentRef,
        String paymentSessionId) {

    /** Same row with the single-use checkout session attached (priced purchase only). */
    public BoostDto withPaymentSessionId(String sessionId) {
        return new BoostDto(id, propertyId, packId, startsAt, endsAt, status, paymentRef,
                sessionId);
    }
}
