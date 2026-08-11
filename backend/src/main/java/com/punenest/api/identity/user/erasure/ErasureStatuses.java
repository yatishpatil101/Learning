package com.punenest.api.identity.user.erasure;

import java.util.Set;

/**
 * The {@code erasure_requests.status} vocabulary, and the one legal transition out of each.
 *
 * <p>Declared beside the values per api-standards.md §7.1, so an illegal move is a 422 with an
 * explanation rather than a row in a state no queue query looks for.
 */
public final class ErasureStatuses {

    private ErasureStatuses() {
    }

    /** Filed by the subject, not yet acted on. Every request starts here. */
    public static final String PENDING = "pending";

    /**
     * Carried out. Terminal, and terminal in a stronger sense than usual: by the time a request
     * reaches this state the account it named no longer exists in identifiable form, so there is
     * nothing left for a reversal to act on. The database enforces the pairing —
     * {@code erasure_requests_completed_is_anonymous} refuses a completed row that still carries a
     * {@code subject_id}.
     */
    public static final String COMPLETED = "completed";

    /**
     * Refused, with a recorded reason. Terminal.
     *
     * <p>A rejection is a real outcome rather than an escape hatch: DPDP s.8(7) permits retention
     * where another law requires it, and a subject with a live registered rent agreement or an
     * unsettled payment is a case where the platform must say no and say why. The subject may file
     * again once the obligation ends, which is the correct shape — the refusal is about today's
     * facts, not about them.
     */
    public static final String REJECTED = "rejected";

    /** Terminal states. A decided request is never reopened; a fresh ask is a fresh request. */
    private static final Set<String> TERMINAL = Set.of(COMPLETED, REJECTED);

    /** True if {@code value} is one of the three states. */
    public static boolean isValid(String value) {
        return PENDING.equals(value) || TERMINAL.contains(value);
    }

    /** True if a request in {@code from} may still be decided. */
    public static boolean isDecidable(String from) {
        return PENDING.equals(from);
    }
}
