package com.draazy.api.security;

import java.util.Set;

/**
 * The ops team vocabulary — the second axis of staff authorization, beside {@link Roles}.
 *
 * <p>A role says <em>what kind</em> of actor you are; a team says <em>whose work</em> you may
 * touch. Both are needed: {@code staff} alone would let the packers desk close a legal opinion.
 * The values mirror the {@code users.team} and {@code tickets.team} CHECK constraints (V2, V7) and
 * the contract's {@code Team} enum, which is why they live beside {@link AuthPrincipal#team()}
 * rather than inside a feature — a feature-local copy would be a third place for the list to drift.
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

    /** Is this a team the platform recognises? Used to reject a filter, never to grant access. */
    public static boolean isKnown(String team) {
        return team != null && ALL.contains(team);
    }
}
