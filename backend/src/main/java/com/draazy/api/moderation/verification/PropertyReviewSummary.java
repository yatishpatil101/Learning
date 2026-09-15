package com.draazy.api.moderation.verification;

import java.time.Instant;

/**
 * Paged queue shape for {@code /admin/property-reviews} and {@code /me/property-reviews}. {@code
 * unread} means the opposite side on each route — a message is unread to whoever did not send it.
 */
public record PropertyReviewSummary(
        String propertyId,
        String status,
        String reviewer,
        int unread,
        Instant decidedAt,
        Instant updatedAt,
        String propertyTitle,
        String propertyImage,
        String lastMessage,
        Instant lastMessageAt,
        String lifecycleTrack,
        String lifecycleStage) {
}
