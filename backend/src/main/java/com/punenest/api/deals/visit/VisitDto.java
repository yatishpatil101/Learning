package com.punenest.api.deals.visit;

import java.time.Instant;

/**
 * One visit as the wire sees it (contract {@code Visit}).
 *
 * <p>{@link #visitor} is a {@link Party} object — the visitor's identity with a mobile that is
 * contact-gated (masked until the owner confirms the visit or an approved contact request exists).
 *
 * @param id         opaque visit id
 * @param propertyId the listing the visit is against
 * @param visitor    the visitor as a {@link Party} (masked mobile until confirmed)
 * @param slot       the proposed date/time as a single ISO instant
 * @param mode       {@code in-person} or {@code video}
 * @param status     one of {@link VisitStatuses}
 * @param createdAt  when the visit was booked
 */
public record VisitDto(
        String id,
        String propertyId,
        Party visitor,
        Instant slot,
        String mode,
        String status,
        Instant createdAt) {

    /**
     * A platform user acting as a participant on the visit (contract {@code Party}).
     *
     * @param id     user id
     * @param name   display name
     * @param mobile contact-gated; masked ({@code 98XXXXX210}) until the owner has confirmed
     * @param role   always {@code buyer} (the visitor)
     */
    public record Party(String id, String name, String mobile, String role) {
    }
}
