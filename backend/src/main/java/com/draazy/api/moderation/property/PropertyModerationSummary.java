package com.draazy.api.moderation.property;

public record PropertyModerationSummary(
        long total,
        long approved,
        long pending,
        long flagged,
        long featured,
        long recheck,
        long archived,
        long badgeRequests,
        long unconfirmed) {
}
