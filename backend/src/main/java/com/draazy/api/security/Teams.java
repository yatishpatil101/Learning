package com.draazy.api.security;

import java.util.List;
import java.util.Set;

/**
 * The ops team vocabulary — the second axis of staff authorization, beside {@link Roles}. A role
 * says what kind of actor you are; a team says whose work you may touch.
 */
public final class Teams {

    private Teams() {
    }

    public static final String RENTAL = "rental";
    public static final String LEGAL = "legal";
    public static final String LOANS = "loans";
    public static final String INTERIOR = "interior";
    public static final String PACKERS = "packers";
    public static final String VALUATION = "valuation";

    private static final Set<String> ALL =
            Set.of(RENTAL, LEGAL, LOANS, INTERIOR, PACKERS, VALUATION);

    /** Is this a team the platform recognises? Rejects a filter value, never grants access. */
    public static boolean isKnown(String team) {
        return team != null && ALL.contains(team);
    }

    /** The vocabulary, sorted, for an error message that tells the caller what was expected. */
    public static List<String> known() {
        return ALL.stream().sorted().toList();
    }
}
