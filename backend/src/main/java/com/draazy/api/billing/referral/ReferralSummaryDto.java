package com.draazy.api.billing.referral;

/** The referrer's own view of their scheme. Contacts a referral bought are read from {@code GET /me/entitlements},
 * which derives them from the same referrals. */
public record ReferralSummaryDto(
        String code,
        int invited,
        int converted) {
}