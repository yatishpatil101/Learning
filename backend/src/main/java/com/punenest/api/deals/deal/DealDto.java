package com.punenest.api.deals.deal;

import java.time.Instant;

/**
 * One deal as the wire sees it (contract {@code Deal}).
 *
 * <p>{@link #counterparty} is a {@link Party} — for an off-platform close, {@code id} and
 * {@code name} may be null; the mobile is always present (the owner typed it in). Mobile
 * visibility: always revealed to the owner (they entered it themselves).
 *
 * @param id           opaque deal id (null for synthesized active deals)
 * @param propertyId   the listing
 * @param deal         {@code buy} or {@code rent}
 * @param counterparty the other side of the deal, if closed
 * @param agreedPrice  whole INR, set on close
 * @param status       one of {@link DealStatuses}
 * @param closedAt     when the deal was closed
 */
public record DealDto(
        String id,
        String propertyId,
        String deal,
        Party counterparty,
        Long agreedPrice,
        String status,
        Instant closedAt) {

    /**
     * A platform or off-platform participant on the deal (contract {@code Party}).
     *
     * @param id     user id if on-platform, else null
     * @param name   display name if known
     * @param mobile always revealed to the owner (they typed it in on close)
     * @param role   {@code buyer} or {@code owner}
     */
    public record Party(String id, String name, String mobile, String role) {
    }
}
