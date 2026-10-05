package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.ListingProgress;
import java.time.Instant;

public record PropertyReviewSummary(
        String propertyId,
        String status,
        String reviewer,
        String reviewerName,
        int unread,
        Instant decidedAt,
        Instant updatedAt,
        String propertyTitle,
        String propertyImage,
        String lastMessage,
        Instant lastMessageAt,
        String reasonCode,
        String reasonNote,
        ListingProgress progress) {
}
