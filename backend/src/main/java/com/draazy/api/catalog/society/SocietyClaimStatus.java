package com.draazy.api.catalog.society;

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

    /**
     * The whole vocabulary, for callers that have to check one that arrived off the wire.
     *
     * <p>Here rather than as a {@code @Pattern} on the request record, so that the three values and
     * the set of the three values cannot drift apart. It still is not the authority — the
     * {@code societies_claim_status_check} constraint is — but a caller that checks against this
     * turns a database error into a 422 that names the field.
     */
    public static final java.util.Set<String> ALL = java.util.Set.of(UNCLAIMED, PENDING, CLAIMED);

    private SocietyClaimStatus() {
    }
}
