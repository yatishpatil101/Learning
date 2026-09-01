package com.punenest.api.engagement.society;

import java.util.Set;

/**
 * How a resident describes their tie to the flat (V101 {@code society_residents_relation_check}).
 *
 * <p>It matters to a reader: "the owner of B/704 says the water is fine" and "a tenant in B/704 says
 * the water is fine" are different claims, and a tenant is the one who has actually lived through a
 * summer. {@link #RESIDENT} is the honest default for somebody who does not want to say.
 */
public final class SocietyResidentRelations {

    public static final String OWNER = "owner";

    public static final String TENANT = "tenant";

    /** Living with the owner or tenant — an adult child, a parent. */
    public static final String FAMILY = "family";

    /** Unstated. The default, and never inferred from anything else. */
    public static final String RESIDENT = "resident";

    private static final Set<String> ALL = Set.of(OWNER, TENANT, FAMILY, RESIDENT);

    private SocietyResidentRelations() {
    }

    /** Whether {@code relation} is one the DB check constraint will accept. */
    public static boolean isValid(String relation) {
        return relation != null && ALL.contains(relation);
    }
}
