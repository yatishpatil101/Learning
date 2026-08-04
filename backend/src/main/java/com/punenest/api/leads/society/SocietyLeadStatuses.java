package com.punenest.api.leads.society;

import java.util.Set;

/** The B2B pipeline columns (contract {@code SocietyLead.status}, V24 check constraint). */
public final class SocietyLeadStatuses {

    /** Submitted, nobody has called yet. */
    public static final String NEW = "new";

    /** Ops has made contact. */
    public static final String CONTACTED = "contacted";

    /** Worth pursuing — the society is real and the units are plausible. */
    public static final String QUALIFIED = "qualified";

    /** Signed. */
    public static final String WON = "won";

    /** Not proceeding. Reversible; see {@code SocietyLead.moveTo}. */
    public static final String LOST = "lost";

    private static final Set<String> ALL = Set.of(NEW, CONTACTED, QUALIFIED, WON, LOST);

    private SocietyLeadStatuses() {
    }

    /** Whether {@code status} is one the DB check constraint will accept. */
    public static boolean isValid(String status) {
        return status != null && ALL.contains(status);
    }
}
