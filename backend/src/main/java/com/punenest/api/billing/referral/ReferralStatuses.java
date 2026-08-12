package com.punenest.api.billing.referral;

import java.util.Set;

/**
 * The {@code Referral.status} vocabulary (contract enum; {@code referrals.status} CHECK, V7
 * extended by V23). Constants rather than an enum per {@code api-standards.md} §7.1.
 *
 * <p>{@link #CLAWED_BACK} was added by spec fix S52. Folding a reversal into {@link #REJECTED}
 * would lose the one distinction a fraud desk needs: a reward that was never paid versus one that
 * was paid and then recovered.
 *
 * <p>{@link #QUALIFIED} was declared by the contract and produced by no code path for as long as
 * nothing tracked whether a referred party had genuinely used the platform (D56). Q17 settled what
 * counts — the referee's first listing passing ownership verification — and
 * {@link ReferralQualification} is the one thing that writes it. It still pays nothing on its own:
 * a qualified referral is a referral a checker can approve without wondering, not one that has been
 * approved.
 */
public final class ReferralStatuses {

    private ReferralStatuses() {
    }

    /** Redeemed, awaiting review. */
    public static final String PENDING = "pending";

    /**
     * The referred party's first listing has passed ownership verification (Q17). Written only by
     * {@link ReferralQualification}; still awaiting a checker's approval before anything is paid.
     */
    public static final String QUALIFIED = "qualified";

    /** Approved by a checker; the reward counts as earned. */
    public static final String REWARDED = "rewarded";

    /** Refused by a checker; nothing was ever paid. */
    public static final String REJECTED = "rejected";

    /** A released reward, reversed. Distinct from {@link #REJECTED} on purpose (spec fix S52). */
    public static final String CLAWED_BACK = "clawed-back";

    /** States a checker may still approve or reject from. */
    private static final Set<String> REVIEWABLE = Set.of(PENDING, QUALIFIED);

    /** Statuses whose reward is owed but not yet released — {@code ReferralSummary.rewardsPending}. */
    private static final Set<String> PENDING_REWARD = Set.of(PENDING, QUALIFIED);

    /** Whether a checker may still approve or reject this referral. */
    public static boolean isReviewable(String status) {
        return REVIEWABLE.contains(status);
    }

    /** Whether this referral's reward is promised but not yet released. */
    public static boolean isRewardPending(String status) {
        return PENDING_REWARD.contains(status);
    }
}
