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
 * @param rewardAmount the magnitude of that label — a count of **owner contacts**, not money. It
 *                     read "whole rupees" here until D31b, which moved the server onto the unit the
 *                     label and the browser had always used; {@code Referral} carries the full
 *                     account of why the column can hold two eras of the offer at once
 * @param channel      which side of the marketplace the referred party joined on — not how the link
 *                     was shared, which is {@code shareChannel} (D60)
 * @param shareChannel how the link reached the referee, or null when unknown; null is the common
 *                     case, because a code passed on by voice carries nothing to report
 * @param sameDevice   referrer and referee redeemed from matching User-Agent digests. False when
 *                     either side has none — a code minted before V64, or a request without the
 *                     header — so a false here means "no evidence", never "proved different"
 * @param sameIp       as {@code sameDevice}, for the client address
 * @param qualifiedAt  when the referee's first listing passed ownership verification (Q17), or null
 *                     while it has not
 */
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
        boolean aadhaarVerified,
        boolean aadhaarUnique,
        boolean sameDevice,
        boolean sameIp,
        boolean velocityHigh,
        boolean activated,
        Instant at,
        Instant qualifiedAt,
        String handledBy,
        Instant handledAt) {
}
