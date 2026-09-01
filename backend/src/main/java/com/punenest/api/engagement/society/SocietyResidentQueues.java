package com.punenest.api.engagement.society;

/**
 * Who owes a residency request a decision (V101 {@code society_residents_assigned_to_check}).
 *
 * <p>A claimed society reviews its own residents — the committee knows who lives in B/704 and we do
 * not. An unclaimed one has nobody to, so ops do it, because the alternative is that nobody in an
 * unclaimed society can ever post and the hub stays empty exactly where it most needs seeding.
 *
 * <p>Stamped at request time rather than derived on read. If it were derived, approving a society's
 * claim would silently move every request already sitting in the ops queue into a committee inbox
 * that has never seen them, and the ops reviewer part-way through the batch would watch it empty.
 */
public final class SocietyResidentQueues {

    /** Reviewed by platform staff. The default, and the only queue for an unclaimed society. */
    public static final String OPS = "ops";

    /** Reviewed by the society's own approved claimant. */
    public static final String COMMITTEE = "committee";

    private SocietyResidentQueues() {
    }
}
