package com.punenest.api.billing.referral;

import java.time.Instant;

/**
 * Contract {@code Referral} — the admin/ops fraud-desk view (spec fixes S52, S53, S54).
 *
 * <p><strong>Both mobiles are masked.</strong> This is a paginated list, and the platform's rule for
 * a privileged list is the one {@code UserAdminService} already sets: the list is masked, and an
 * unmasked read is a separate, audited, single-record operation. The contract declares no such
 * operation for referrals, so nothing here reveals a number. The desk's job is served by the
 * signals below, which are computed server-side from the unmasked data.
 *
 * @param reward       the human label the referrer was promised
 * @param rewardAmount what that label costs, whole rupees (spec fix S54)
 * @param sameDevice   always false — the platform captures no device fingerprint
 * @param sameIp       always false — the platform does not store the request IP
 */
public record ReferralDto(
        String id,
        String referrer,
        String referrerMobile,
        String referred,
        String referredMobile,
        String channel,
        String reward,
        long rewardAmount,
        String status,
        String risk,
        boolean aadhaarVerified,
        boolean aadhaarUnique,
        boolean sameDevice,
        boolean sameIp,
        boolean velocityHigh,
        boolean activated,
        Instant at,
        String handledBy,
        Instant handledAt) {
}
