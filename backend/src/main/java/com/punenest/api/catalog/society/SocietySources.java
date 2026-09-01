package com.punenest.api.catalog.society;

/**
 * The three provenances {@code societies.source} may hold.
 *
 * <p>The column's CHECK constraint is the authority; this exists so the one place that compares
 * against {@code "community"} does not do it with a bare string literal that a rename would leave
 * silently matching nothing.
 */
public final class SocietySources {

    /** Typed in by us. */
    public static final String CURATED = "curated";

    /** Bulk-imported from a MahaRERA filing. */
    public static final String RERA = "rera";

    /** Added by a member because the catalogue did not have it. The only kind ops has to verify. */
    public static final String COMMUNITY = "community";

    private SocietySources() {
    }
}
