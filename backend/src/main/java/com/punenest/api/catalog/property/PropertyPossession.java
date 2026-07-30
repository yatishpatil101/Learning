package com.punenest.api.catalog.property;

/**
 * Possession state of a listing ({@code properties.possession}) — when a buyer can actually move in.
 *
 * <p>Mirrors the OpenAPI {@code PropertyPossession} enum. Like {@link PropertyStatus} the values are
 * persisted verbatim in the column and returned verbatim on the wire, so a rename is simultaneously a
 * migration and a breaking contract change. A DB {@code CHECK} constraint (V10) enforces the same set
 * at the storage layer, so an out-of-vocabulary value cannot enter through any path that bypasses
 * Bean Validation.
 *
 * <p><strong>Why the column is nullable and the filter is exact-match.</strong> {@code null} means
 * "not stated", which is genuinely different from any of the three states — a listing with unknown
 * possession must <em>not</em> match a "Ready to move" search, or the facet would quietly promise
 * something the data does not support. Legacy rows and land/plot listings legitimately sit here.
 *
 * <p><strong>Why these spellings.</strong> The React client uses the shorthand
 * {@code ready|new|under} internally; that vocabulary is a UI implementation detail and reads poorly
 * as a long-lived public contract ({@code possession=new} is ambiguous). The wire therefore uses
 * self-describing hyphenated values, consistent with the existing {@code semi-furnished} and
 * {@code per-month} precedents, and the frontend's http property mapper translates them to its own
 * shorthand — which is exactly the renaming job that mapper already exists to do.
 */
public final class PropertyPossession {

    private PropertyPossession() {
    }

    /** Completed and available to occupy now. The normal state for a rental. */
    public static final String READY_TO_MOVE = "ready-to-move";

    /** A newly launched project — sold before or early in construction. */
    public static final String NEW_LAUNCH = "new-launch";

    /** Under construction, with possession at a future date. */
    public static final String UNDER_CONSTRUCTION = "under-construction";

    /**
     * Bean-Validation regex accepting exactly the three states. Must be a compile-time constant to be
     * usable in {@code @Pattern}, so it is composed from the constants above rather than hand-written
     * — the accepted input set and the domain constants therefore cannot drift apart.
     */
    public static final String PATTERN = READY_TO_MOVE + "|" + NEW_LAUNCH + "|" + UNDER_CONSTRUCTION;

    /** Validation message paired with {@link #PATTERN}. */
    public static final String PATTERN_MESSAGE =
            "must be ready-to-move, new-launch or under-construction";
}
