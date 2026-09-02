package com.draazy.api.identity.user;

import java.util.Set;

/**
 * The three values {@code users.status} may hold, as CHECKed by V2.
 *
 * <p>Strings rather than a Java enum, matching the schema's "text + CHECK" policy across the
 * platform: adding a state is one ALTER and no Java change, and the database stays the authority on
 * what is legal rather than a mirror of it.
 *
 * <p><strong>{@code status} and the soft-delete {@code archived} flag are independent columns and
 * both are load-bearing.</strong> That is not redundancy left over from an earlier design. Every
 * read path on the platform filters on {@code archived}, which is what makes archiving a removal;
 * {@code status} says how the account stands while it is still <em>in</em> the directory. A
 * suspended account is meant to be seen — by the moderator working the case — and merely unable to
 * sign in. Collapsing the two would mean the only way to stop somebody signing in was to hide them
 * from the people investigating them.
 *
 * @see #SUSPENDED for the state that lay unwritten in the constraint from V2 until V77
 */
public final class UserStatuses {

    /** The normal state. Everything works. */
    public static final String ACTIVE = "active";

    /**
     * Cannot obtain a session; otherwise fully present.
     *
     * <p>Enforced in {@code identity.auth.AuthService}, on the one method every issuing path shares.
     * A status column nobody checks would be a moderation button that changes a badge, which is
     * worse than no button — the moderator would believe the person had been stopped.
     */
    public static final String SUSPENDED = "suspended";

    /**
     * Set only by DPDP erasure ({@code User#erasePersonalData}), which needs the strongest of the
     * three and has no separate {@code erased} value to reach for.
     *
     * <p>Note that ordinary archiving does <em>not</em> write this — it sets the {@code archived}
     * flag and leaves {@code status} alone — so "status is archived" is a much narrower statement
     * than "the account is archived". {@code UserAdminService#reactivate} refuses on this value
     * precisely because reaching it means something irreversible has happened.
     */
    public static final String ARCHIVED = "archived";

    /** The full set, for validating a filter parameter before it reaches the query. */
    public static final Set<String> ALL = Set.of(ACTIVE, SUSPENDED, ARCHIVED);

    private UserStatuses() {
    }
}
