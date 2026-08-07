package com.punenest.api.deals.finalization;

import java.time.Instant;

/**
 * One finalization request as the wire sees it (contract {@code FinalizationRequest}).
 *
 * <p>{@link #initiator} and {@link #counterparty} are {@link Party} objects with contact-gated
 * mobiles: masked while the request is {@code pending}, revealed once {@code accepted} (D5).
 *
 * @param id           opaque request id
 * @param propertyId   the listing being finalized
 * @param initiator    the buyer/maker as a {@link Party}
 * @param counterparty the owner/checker as a {@link Party}
 * @param agreedPrice  whole INR — the agreed transaction price
 * @param status       one of {@link FinalizationStatuses}
 * @param createdAt    when the request was created
 */
public record FinalizationRequestDto(
        String id,
        String propertyId,
        Party initiator,
        Party counterparty,
        long agreedPrice,
        String status,
        Instant createdAt) {

    /**
     * A platform user as a participant (contract {@code Party}).
     *
     * @param id     user id
     * @param mobile contact-gated; masked ({@code 98XXXXX210}) while pending, revealed on acceptance
     * @param role   {@code buyer} or {@code owner}
     */
    public record Party(String id, String name, String mobile, String role) {
    }
}
