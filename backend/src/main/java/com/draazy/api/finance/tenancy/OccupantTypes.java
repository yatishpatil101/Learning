package com.draazy.api.finance.tenancy;

import java.util.Set;

/**
 * Who will occupy the home — the contract's {@code TenantProfile.occupants} vocabulary (spec fix
 * S21). Feature-owned {@code String} constants per {@code api-standards.md} §7.1, not an enum.
 *
 * <p><strong>Why this is a screening facet and not free text.</strong> In Pune this is the attribute
 * an owner or a society actually decides on: many buildings refuse bachelors outright, and a
 * company lease is a different counterparty with a different risk profile again. An unrecognised
 * value would not be a harmless typo — it would silently drop the tenant out of every owner's
 * filter, which looks to the tenant like nobody is interested. So the value is validated here and
 * again by V10's CHECK constraint.
 */
public final class OccupantTypes {

    private OccupantTypes() {
    }

    /** A family unit — the least-restricted category. */
    public static final String FAMILY = "family";

    /** One or more unrelated working men. */
    public static final String BACHELOR_MALE = "bachelor_male";

    /** One or more unrelated working women. */
    public static final String BACHELOR_FEMALE = "bachelor_female";

    /** An employer leasing on an employee's behalf; the company is the counterparty. */
    public static final String COMPANY_LEASE = "company_lease";

    private static final Set<String> ALL =
            Set.of(FAMILY, BACHELOR_MALE, BACHELOR_FEMALE, COMPANY_LEASE);

    /** Whether {@code value} is a recognised occupant type. {@code null} is permitted (unset). */
    public static boolean isValid(String value) {
        return value == null || ALL.contains(value);
    }
}
