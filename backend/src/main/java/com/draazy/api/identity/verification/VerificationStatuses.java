package com.draazy.api.identity.verification;

/**
 * Lifecycle vocabulary of the opt-in identity badge, mirroring the V23 CHECK on
 * {@code identity_verifications.status}. Never gates participation (ADR-019).
 */
public final class VerificationStatuses {

    private VerificationStatuses() {
    }

    /** No case exists. Never stored — the wire answer for a user with no row. */
    public static final String NONE = "none";

    /** Photos are in the staff queue awaiting a decision. */
    public static final String PENDING = "pending";

    /** A reviewer approved the case; the badge is granted. */
    public static final String VERIFIED = "verified";

    /** A reviewer rejected the case with a reason; the user may resubmit within the attempt cap. */
    public static final String REJECTED = "rejected";
}
