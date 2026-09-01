package com.punenest.api.billing.referral;

/**
 * Contract {@code ReferralSummary} — the referrer's own view of their scheme.
 *
 * <p><strong>Denominated in owner contacts, not rupees (D31b).</strong> This record used to carry
 * {@code rewardsEarned} and {@code rewardsPending} as whole rupees. The frontend fetched both and
 * rendered neither, for the simple reason that there was no rupee anywhere in the product to spend
 * them on — no wallet, no credit note, no discount at any checkout. Meanwhile every screen the
 * referrer could see promised "+15 owner contacts", and the API contract documented
 * {@code Referral.reward} as exactly that. The money was the part nobody had agreed to.
 *
 * <p>{@code contactsEarned} is therefore the number the referrer can act on today, and the only
 * number this record needs to be trusted on: it is the same figure {@code GET /me/entitlements}
 * derives, from the same referrals, so the Refer page and the contact gate cannot disagree about
 * what a referral bought.
 *
 * @param code            the shareable code, e.g. {@code PUNE-AB12}
 * @param invited         how many people have redeemed this code
 * @param converted       how many of those have qualified or been approved — the ones that paid
 * @param contactsEarned  owner contacts already granted by qualified and approved referrals
 * @param contactsPending owner contacts promised by referrals that have not qualified yet
 */
public record ReferralSummaryDto(
        String code,
        int invited,
        int converted,
        int contactsEarned,
        int contactsPending) {
}
