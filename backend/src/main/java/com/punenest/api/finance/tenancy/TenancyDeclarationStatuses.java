package com.punenest.api.finance.tenancy;

/**
 * The three states of a {@link TenancyDeclaration}, matching the V68 CHECK constraint.
 *
 * <p>There is no {@code declined}. An owner who disagrees with a claim and an owner who withdraws a
 * confirmation they already gave want the same outcome — this person may not review the listing on
 * the strength of this row — and giving that outcome two names would mean every later reader had to
 * remember both. {@code revoked} is deliberately re-confirmable: the common real case is an owner
 * mis-tapping a name on a list, not an owner making a finding.
 */
public final class TenancyDeclarationStatuses {

    /** Claimed, not yet answered. Proves nothing. */
    public static final String PENDING = "pending";

    /** The owner agreed. This is the only status that counts as evidence. */
    public static final String CONFIRMED = "confirmed";

    /** The owner disagreed, or withdrew an earlier confirmation. */
    public static final String REVOKED = "revoked";

    private TenancyDeclarationStatuses() {
    }
}
