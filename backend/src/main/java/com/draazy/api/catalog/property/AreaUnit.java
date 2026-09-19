package com.draazy.api.catalog.property;

/**
 * Units a stated area may be measured in. No {@code CHECK} stands behind the column, so this regex is the
 * whole constraint on text rendered verbatim on the public page; {@code null} means sq.ft.
 */
public final class AreaUnit {

    private AreaUnit() {
    }

    public static final String SQFT = "sqft";

    public static final String SQYD = "sqyd";

    /** 1/40th of an acre, and how Pune plots are actually quoted. */
    public static final String GUNTHA = "guntha";

    public static final String ACRE = "acre";

    public static final String HECTARE = "hectare";

    /**
     * Bean-Validation regex accepting exactly the five units. Composed from the constants rather
     * than hand-written so the accepted input set cannot drift from the domain.
     */
    public static final String PATTERN =
            SQFT + "|" + SQYD + "|" + GUNTHA + "|" + ACRE + "|" + HECTARE;

    /** Validation message paired with {@link #PATTERN}. */
    public static final String PATTERN_MESSAGE =
            "must be sqft, sqyd, guntha, acre or hectare";
}
