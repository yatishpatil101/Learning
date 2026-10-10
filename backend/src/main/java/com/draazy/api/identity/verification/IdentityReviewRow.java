package com.draazy.api.identity.verification;

import java.time.Instant;
import java.util.UUID;

// One queue line; the case itself (claims, images, warnings, account) is the detail read.
public record IdentityReviewRow(
        UUID id,
        String status,
        String userName,
        String userMobile,
        String docType,
        Instant submittedAt,
        Instant decidedAt,
        Instant revokedAt,
        String approvedByName,
        String claimedByName,
        boolean claimedByMe,
        Instant qaSampledAt) {
}
