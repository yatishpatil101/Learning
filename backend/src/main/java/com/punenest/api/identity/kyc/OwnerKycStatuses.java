package com.punenest.api.identity.kyc;

/**
 * The {@code OwnerKyc.status} vocabulary, mirroring the V6 CHECK.
 *
 * <p>All three are provider verdicts. Nothing in the API can move a record to {@link #VERIFIED} —
 * that arrives from the KYC provider — which is the whole reason {@code OwnerKycUpdate} (spec fix
 * S36) does not carry a status field.
 */
public final class OwnerKycStatuses {

    private OwnerKycStatuses() {
    }

    public static final String PENDING = "pending";
    public static final String VERIFIED = "verified";
    public static final String REJECTED = "rejected";
}
