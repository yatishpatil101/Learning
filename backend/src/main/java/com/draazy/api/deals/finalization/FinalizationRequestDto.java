package com.draazy.api.deals.finalization;

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
     * <p><strong>{@code verified} is on this object because it cannot be derived from
     * {@code mobile}</strong> (tech-debt D114). A counterparty's number stays masked at every
     * status here, so a client matching {@code 98XXXXX210} against the verified list would answer
     * "not verified" for every party forever. The badge is a fact the server already holds; it is
     * stated rather than left to be reconstructed from digits that were deliberately destroyed.
     *
     * @param id       user id
     * @param mobile   contact-gated; masked ({@code 98XXXXX210}) while pending, revealed on acceptance
     * @param role     {@code buyer} or {@code owner}
     * @param verified whether this party carries the Verified Tenant badge
     */
    public record Party(String id, String name, String mobile, String role, boolean verified) {
    }
}
