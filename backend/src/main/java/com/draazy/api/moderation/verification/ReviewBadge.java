package com.draazy.api.moderation.verification;

import java.time.Instant;

/** One listing's review state as the owner's dashboard card renders it. Carries no staff id, reviewer name or
 * listing copy: the card already holds the listing. */
public record ReviewBadge(
        String propertyId,
        String status,
        int unread,
        Instant updatedAt,
        String reasonCode,
        String reasonNote,
        String lastMessage) {
}
