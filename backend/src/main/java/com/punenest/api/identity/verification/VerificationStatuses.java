package com.punenest.api.identity.verification;

/**
 * The lifecycle vocabulary of the opt-in identity badge, mirroring the V2 CHECK constraint on
 * {@code identity_verifications.status} and the {@code AadhaarVerification.status} enum in the spec.
 *
 * <p>{@code String} constants, not a Java {@code enum} ({@code api-standards.md} §7.1): these are
 * wire tokens the React client renders directly, and a constant keeps store → serialize at one hop.
 *
 * <p><strong>None of these ever gates participation</strong> (ADR-019). {@link #NONE} is the normal,
 * fully-functional state of most accounts; the badge only adds ranking and filter eligibility.
 */
public final class VerificationStatuses {

    private VerificationStatuses() {
    }

    /** No verification has been attempted. The default, and never an error. */
    public static final String NONE = "none";

    /** A DigiLocker consent flow is in flight; we are waiting for the webhook. */
    public static final String PENDING = "pending";

    /** DigiLocker confirmed the identity; the badge is granted. */
    public static final String VERIFIED = "verified";

    /**
     * The attempt did not grant a badge. Two distinguishable causes, per the slice-3 reconciliation
     * log (i): {@code failed} <em>with</em> a stored {@code masked_aadhaar} means the identity was
     * already claimed by another account (a dedup collision — the 409 path), while {@code failed}
     * <em>without</em> one means the user abandoned or failed consent and may simply retry.
     */
    public static final String FAILED = "failed";

    /**
     * Whether a row in this state represents a dedup collision rather than a retryable failure.
     *
     * <p>Lives here because it is the meaning of {@link #FAILED}, and because {@code submitAadhaar}
     * and the webhook must agree on it exactly — one is where the marker is written, the other is
     * where it becomes a {@code 409}.
     */
    public static boolean isIdentityCollision(String status, String maskedAadhaar) {
        return FAILED.equals(status) && maskedAadhaar != null && !maskedAadhaar.isBlank();
    }
}
