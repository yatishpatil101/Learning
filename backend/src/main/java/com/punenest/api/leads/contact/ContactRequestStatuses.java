package com.punenest.api.leads.contact;

/**
 * The persisted subset of the contact vocabulary — the three values {@code contact_requests.status}
 * may physically hold, mirrored from the V4 CHECK constraint.
 *
 * <p>Separate from {@link ContactStatuses} on purpose: that type is the <em>wire</em> vocabulary a
 * viewer sees (five values, two of them computed), this one is the <em>column</em> vocabulary. Fusing
 * them would invite writing {@code owner} or {@code none} into a row the database would then reject
 * at runtime rather than at review time.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1. Every value is
 * traced to the {@code ContactRequest.status} enum in the OpenAPI spec and to the V4 CHECK.
 */
public final class ContactRequestStatuses {

    private ContactRequestStatuses() {
    }

    /** Awaiting the owner's decision. The only state a new row is ever created in. */
    public static final String PENDING = "pending";

    /** The owner granted contact. */
    public static final String APPROVED = "approved";

    /** The owner refused. Terminal. */
    public static final String DECLINED = "declined";

    /**
     * Validation pattern for {@code StatusUpdate.status} on {@code respondContactRequest}, composed
     * from the constants so the regex can never drift from the vocabulary it validates.
     *
     * <p>{@link #PENDING} is deliberately absent: the contract's only transitions are approve and
     * decline, and "un-decide" is not a product behaviour we support.
     */
    public static final String RESPONSE_PATTERN = "^(" + APPROVED + "|" + DECLINED + ")$";

    /**
     * Whether {@code current} may move to {@code next}. Only {@code pending → approved|declined} is
     * legal; both end states are terminal, so a second PATCH is rejected rather than silently
     * flipping an already-answered request (which would let an owner revoke a reveal the requester
     * has already seen, and would make the audit trail lie).
     */
    public static boolean canTransition(String current, String next) {
        return PENDING.equals(current) && (APPROVED.equals(next) || DECLINED.equals(next));
    }
}
