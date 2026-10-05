package com.draazy.api.identity.verification;

// Mirrors the status CHECK; never gates participation.
public final class VerificationStatuses {

    private VerificationStatuses() {
    }

    /** No case exists. Never stored — the wire answer for a user with no row. */
    public static final String NONE = "none";

    public static final String PENDING = "pending";

    public static final String VERIFIED = "verified";

    /** A reviewer rejected the case with a reason; the user may resubmit within the attempt cap. */
    public static final String REJECTED = "rejected";

    public static final String REVOKED = "revoked";

    public static final String WITHDRAWN = "withdrawn";
}
