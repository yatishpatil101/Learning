package com.draazy.api.moderation.enquiry;

import java.time.Instant;

/** {@code counterpartyMobile} prefers the number typed on an off-platform close (name then null); {@code agreedPrice} is null until close. */
public record AdminDealDto(
        String id,
        String propertyId,
        String propertyTitle,
        String locality,
        String deal,
        String counterpartyName,
        String counterpartyMobile,
        Long agreedPrice,
        String status,
        Instant closedAt,
        Instant createdAt) {
}
