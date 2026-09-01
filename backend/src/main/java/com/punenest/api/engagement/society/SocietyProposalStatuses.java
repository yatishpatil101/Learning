package com.punenest.api.engagement.society;

/**
 * Where a {@link SocietyProposal} is in its life.
 *
 * <p>Deliberately three states and not four: there is no "applied". A proposal is approved once,
 * and approval writes the value onto the society in the same transaction. A separate applied state
 * would exist only to describe the window between the two, and a window that can be observed is a
 * window something can fail in.
 */
public final class SocietyProposalStatuses {

    public static final String PENDING = "pending";
    public static final String APPROVED = "approved";
    public static final String REJECTED = "rejected";

    private SocietyProposalStatuses() {
    }

    public static boolean isDecision(String status) {
        return APPROVED.equals(status) || REJECTED.equals(status);
    }
}
