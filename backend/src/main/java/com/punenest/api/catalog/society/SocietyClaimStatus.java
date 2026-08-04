package com.punenest.api.catalog.society;

/**
 * How much a society record has been vouched for by the society itself (contract
 * {@code Society.claimStatus}).
 *
 * <p>Feature-owned {@code String} constants rather than an enum, per api-standards §7.1: the values
 * are the contract's wire vocabulary and the {@code societies_claim_status_check} constraint is the
 * authority on them, so a second Java-side authority could only ever disagree.
 */
public final class SocietyClaimStatus {

    /** Nobody from the society has come forward. The default for imported and curated records. */
    public static final String UNCLAIMED = "unclaimed";

    /** Somebody has claimed it and is waiting on verification. Not yet a trust signal. */
    public static final String PENDING = "pending";

    /** Verified: the society's own committee maintains this record. */
    public static final String CLAIMED = "claimed";

    private SocietyClaimStatus() {
    }
}
