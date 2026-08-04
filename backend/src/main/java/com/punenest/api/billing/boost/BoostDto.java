package com.punenest.api.billing.boost;

import java.time.Instant;

/**
 * Contract {@code Boost} (spec fix S51).
 *
 * @param startsAt   null until the payment webhook confirms — the window is dated from the money
 * @param paymentRef the gateway order id to hand to the checkout SDK while {@code status} is
 *                   {@code pending}; null on a free pack
 */
public record BoostDto(
        String id,
        String propertyId,
        String packId,
        Instant startsAt,
        Instant endsAt,
        String status,
        String paymentRef) {
}
