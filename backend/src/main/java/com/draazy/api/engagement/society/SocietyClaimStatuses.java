package com.draazy.api.engagement.society;

import java.util.Set;

/**
 * The lifecycle of a {@link SocietyClaim} (V101 {@code society_claims_status_check}).
 *
 * <p>Distinct from {@code catalog.society.SocietyClaimStatus}, which describes the <em>society</em>
 * — unclaimed, pending, claimed. This describes one <em>request</em>. They move together but they
 * are not the same vocabulary: a society is 'pending' while a claim is 'pending', but a society is
 * never 'rejected' and a claim is never 'unclaimed'.
 *
 * <p>Feature-owned {@code String} constants rather than an enum, per api-standards §7.1.
 */
public final class SocietyClaimStatuses {

    /** Submitted, waiting on ops. */
    public static final String PENDING = "pending";

    /** Verified — the claimant now administers the society page. */
    public static final String APPROVED = "approved";

    /**
     * Refused. Deliberately outside {@code ux_society_claims_live}, so the society becomes claimable
     * again: a committee whose paperwork was wrong must be able to try again.
     */
    public static final String REJECTED = "rejected";

    private static final Set<String> DECISIONS = Set.of(APPROVED, REJECTED);

    private SocietyClaimStatuses() {
    }

    /** Whether {@code status} is a decision ops may record. {@link #PENDING} is not one. */
    public static boolean isDecision(String status) {
        return status != null && DECISIONS.contains(status);
    }
}
