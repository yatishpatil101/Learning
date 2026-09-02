package com.draazy.api.billing.referral;

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

    /**
     * Statuses that have earned the owner-contact grant (D31b).
     *
     * <p>{@link #QUALIFIED} is in this set and {@link #PENDING} is not, which is the whole of the
     * decision taken on this item: the grant lands automatically the moment the referred party's
     * first listing passes ownership verification, rather than waiting on a checker. That is a real
     * change of policy — {@link #QUALIFIED} is documented above as "a referral a checker can approve
     * without wondering, not one that has been approved", and it now pays on its own. It is
     * defensible because Q17's qualifying event is an act the platform verified itself, the D61
     * monthly cap already holds the volume down, and what is being handed over is the right to ask
     * fifteen owners a question rather than money.
     *
     * <p>{@link #REWARDED} is here too, so a checker's approval never withdraws a grant the
     * qualification already made. {@link #REJECTED} and {@link #CLAWED_BACK} are not, and because
     * the entitlement is <em>derived</em> from this set rather than stored, a clawback withdraws the
     * contacts the instant the desk records it — the reversal became real rather than cosmetic.
     *
     * <p>This set replaced a {@code PENDING_REWARD} one that answered the opposite question for
     * {@code ReferralSummary.rewardsPending}. That field was rupees, was rendered by nothing, and is
     * gone; "promised but not yet granted" is now simply {@link #PENDING}, and
     * {@code ReferralService.summary} tests for it directly rather than through a set of one.
     */
    private static final Set<String> GRANTING = Set.of(QUALIFIED, REWARDED);

    /** Whether a checker may still approve or reject this referral. */
    public static boolean isReviewable(String status) {
        return REVIEWABLE.contains(status);
    }

    /** Whether this referral has earned its owner-contact grant (D31b). */
    public static boolean isGranting(String status) {
        return GRANTING.contains(status);
    }
}
