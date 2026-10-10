package com.draazy.api.engagement.review;

import java.time.Instant;

/** One row of {@code GET /admin/reviews}: only what the moderation queue renders, with the row's own {@code status}. */
public record ReviewModerationRow(
        String id,
        String targetType,
        String targetId,
        String author,
        int rating,
        String body,
        Instant createdAt,
        String status) {

    static ReviewModerationRow of(Review r, String authorName) {
        return new ReviewModerationRow(r.getId().toString(), r.getTargetType(), r.getTargetId(),
                authorName, r.getRating(), r.getBody(), r.getCreatedAt(), r.getStatus());
    }
}
