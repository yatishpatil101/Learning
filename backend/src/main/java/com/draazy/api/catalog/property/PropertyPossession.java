package com.draazy.api.catalog.property;

// Persisted verbatim and returned verbatim, so a rename is both a migration and a contract break.
// A null column means "not stated" and must not match any state, hence the exact-match filter.
public final class PropertyPossession {

    private PropertyPossession() {
    }

    /** Completed and available to occupy now. The normal state for a rental. */
    public static final String READY_TO_MOVE = "ready-to-move";

    /** A newly launched project — sold before or early in construction. */
    public static final String NEW_LAUNCH = "new-launch";

    /** Under construction, with possession at a future date. */
    public static final String UNDER_CONSTRUCTION = "under-construction";

    /** Composed from the constants so the accepted input set cannot drift; must stay a compile-time constant for {@code @Pattern}. */
    public static final String PATTERN = READY_TO_MOVE + "|" + NEW_LAUNCH + "|" + UNDER_CONSTRUCTION;

    /** Validation message paired with {@link #PATTERN}. */
    public static final String PATTERN_MESSAGE =
            "must be ready-to-move, new-launch or under-construction";

    // "This facet was used and nothing can satisfy it" - a reserved token because Spring binds an
    // absent list and `construction=` identically, and an omitted facet means "not filtered".
    public static final String UNMATCHABLE = "no.such.possession";
}
