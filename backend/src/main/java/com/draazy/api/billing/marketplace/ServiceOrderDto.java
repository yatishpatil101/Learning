package com.draazy.api.billing.marketplace;

import java.time.Instant;

/**
 * Contract {@code ServiceOrder}.
 *
 * <p>{@code propertyId} and {@code notes} are stored but not returned: the contract's response
 * schema has no field for either. Recorded here rather than left as a puzzle for the next reader —
 * the columns exist because {@code ServiceOrderCreate} accepts them and ops needs them to do the
 * job, not because the customer's own list is meant to echo them back.
 *
 * @param amount null until ops quotes the job — the offering's price is a "from", not a charge
 */
public record ServiceOrderDto(
        String id,
        String offeringId,
        String status,
        Long amount,
        Instant scheduledFor,
        Instant createdAt) {
}
