package com.punenest.api.billing.referral;

/**
 * Contract {@code ReferralSummary} — the referrer's own view of their scheme.
 *
 * @param code           the shareable code, e.g. {@code PUNE-AB12}
 * @param invited        how many people have redeemed this code
 * @param converted      how many of those a checker has approved
 * @param rewardsEarned  whole rupees already released
 * @param rewardsPending whole rupees promised but still awaiting review
 */
public record ReferralSummaryDto(
        String code,
        int invited,
        int converted,
        long rewardsEarned,
        long rewardsPending) {
}
