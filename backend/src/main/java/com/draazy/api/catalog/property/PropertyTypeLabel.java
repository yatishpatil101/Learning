package com.draazy.api.catalog.property;

/**
 * The display labels a listing may declare as its {@code property_type}. The column is free text in but is
 * parsed out by generated {@code LIKE} columns, so an unclassifiable label publishes missing from its filter.
 */
public final class PropertyTypeLabel {

    private PropertyTypeLabel() {
    }

    /**
     * Transcribed token-for-token from the generated column's {@code CASE}, {@code .*}-wrapped because those
     * tokens are {@code LIKE '%…%'}: a narrower regex would reject aliases the column keys perfectly well.
     */
    public static final String PATTERN =
            "(?i).*(office|shop|showroom|retail|commercial|warehouse|godown|industrial"
                    + "|co-working|coworking"
                    + "|independent house|row house|villa / house"
                    + "|flat|studio|penthouse|apartment"
                    + "|villa"
                    + "|farm ?land"
                    + "|plot).*";

    /** Names the consequence, not the rule: the cost here is invisibility in search, not a rejected write. */
    public static final String PATTERN_MESSAGE =
            "must name a recognised property type, or the listing cannot be found by its type filter";
}
