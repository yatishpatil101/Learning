package com.punenest.api.finance.tenancy;

/**
 * The tenancy status vocabulary — the three values {@code tenancies.status} may physically hold.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1, traced to:
 * <ul>
 *   <li>V6: {@code CHECK (status IN ('active','ended','terminated'))}</li>
 *   <li>OpenAPI: {@code Tenancy.status} enum</li>
 * </ul>
 *
 * <p><strong>{@code ended} and {@code terminated} are not the same thing</strong>, and the
 * distinction is the reason there are three values rather than two. A tenancy that {@code ended}
 * ran its course — the agreement expired, the tenant moved on, everyone is content. One that was
 * {@code terminated} was cut short: notice served, rent unpaid, a dispute. To a Pune owner reading
 * a tenant's history those two words mean opposite things about that tenant, and collapsing them
 * into "not active" would erase the single most useful signal in the record. It also matters for
 * the deposit: an ended tenancy settles normally, a terminated one usually does not.
 *
 * <p>Both are terminal. A tenancy is never reopened — the tenant moving back in is a new agreement
 * with new dates and a new deposit, and pretending otherwise would leave one row claiming a
 * continuous occupancy that did not happen.
 */
public final class TenancyStatuses {

    private TenancyStatuses() {
    }

    /** The tenant is in occupation. At most one per property — enforced by V12's unique index. */
    public static final String ACTIVE = "active";

    /** Ran its course: the agreement expired or both sides parted on schedule. Terminal. */
    public static final String ENDED = "ended";

    /** Cut short: notice, default or dispute. Terminal, and materially different from {@link #ENDED}. */
    public static final String TERMINATED = "terminated";

    /** Whether {@code value} is one of the three stored statuses. */
    public static boolean isValid(String value) {
        return ACTIVE.equals(value) || ENDED.equals(value) || TERMINATED.equals(value);
    }

    /** Whether the tenancy is over, in either sense. */
    public static boolean isTerminal(String value) {
        return ENDED.equals(value) || TERMINATED.equals(value);
    }

    /**
     * Whether {@code current} may move to {@code next}. The only legal moves are
     * {@code active → ended} and {@code active → terminated}; both targets are terminal.
     */
    public static boolean canTransition(String current, String next) {
        return ACTIVE.equals(current) && isTerminal(next);
    }
}
