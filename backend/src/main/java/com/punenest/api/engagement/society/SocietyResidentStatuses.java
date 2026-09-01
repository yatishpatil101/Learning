package com.punenest.api.engagement.society;

import java.util.Set;

/**
 * The vocabularies a {@link SocietyResident} row is written in (V101 check constraints).
 *
 * <p>Four small holders rather than one, so each names exactly the column it constrains and a
 * caller cannot pass a queue name where a status belongs. Feature-owned {@code String} constants
 * per api-standards §7.1 — the database check constraints are the authority.
 */
public final class SocietyResidentStatuses {

    /** Submitted, waiting on the committee or on ops. */
    public static final String PENDING = "pending";

    /** Verified — this person may post as a resident of this society. */
    public static final String VERIFIED = "verified";

    /** Refused. Reversible by re-applying; see {@code SocietyResident.reapply}. */
    public static final String REJECTED = "rejected";

    private static final Set<String> DECISIONS = Set.of(VERIFIED, REJECTED);

    private SocietyResidentStatuses() {
    }

    /** Whether {@code status} is a decision a reviewer may record. {@link #PENDING} is not one. */
    public static boolean isDecision(String status) {
        return status != null && DECISIONS.contains(status);
    }
}
