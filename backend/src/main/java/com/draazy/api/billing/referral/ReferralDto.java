package com.draazy.api.billing.referral;

import java.time.Instant;

/** Contract {@code Referral} — the admin/ops fraud-desk view. Rationale: docs/flows/ops/referrals-fraud.md. */
public record ReferralDto(
        String id,
        String referrer,
        String referrerMobile,
        String referred,
        String referredMobile,
        String channel,
        String shareChannel,
        String reward,
        long rewardAmount,
        String status,
        String risk,
        boolean identityVerified,
        boolean identityUnique,
        boolean sameDevice,
        boolean sameIp,
        boolean velocityHigh,
        boolean activated,
        Instant at,
        Instant qualifiedAt,
        String handledBy,
        Instant handledAt) {
}
