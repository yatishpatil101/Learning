package com.draazy.api.moderation.user;

import java.time.Instant;

public record BadgeGrantResponse(
        String id,
        String userId,
        String userName,
        String userMobileMasked,
        String requestedBy,
        String requestedByName,
        String reason,
        String status,
        String decidedBy,
        String decidedByName,
        Instant decidedAt,
        String decisionNote,
        Instant createdAt) {
}
