package com.punenest.api.identity.verification;

/**
 * Where a badge came from ({@code identity_verifications.source}, spec {@code AadhaarVerification
 * .source}). One value today; declared as a constant rather than a literal so the second provider —
 * whenever a non-DigiLocker rail is added — is a one-line addition next to its siblings instead of a
 * grep for a quoted string.
 */
public final class VerificationSources {

    private VerificationSources() {
    }

    /** Cashfree-brokered DigiLocker consent — the only rail at MVP. */
    public static final String DIGILOCKER = "digilocker";
}
