package com.draazy.api.catalog.property;

/**
 * Permitted zoning of a plot or farm. Transcribed from the column's own {@code CHECK} rather than the
 * wizard's labels, since the column is what an accepted value has to survive; {@code null} is a building.
 */
public final class LandUse {

    private LandUse() {
    }

    public static final String RESIDENTIAL = "residential";

    public static final String COMMERCIAL = "commercial";

    public static final String INDUSTRIAL = "industrial";

    public static final String AGRICULTURAL = "agricultural";

    /** Sanctioned for more than one use — shop below, home above, the Pune main-road norm. */
    public static final String MIXED = "mixed";

    /**
     * Composed from the constants so the accepted set cannot drift from the domain. Blank is excluded
     * because the column's {@code CHECK} rejects it, which would be a 500 rather than an actionable 422.
     */
    public static final String PATTERN =
            RESIDENTIAL + "|" + COMMERCIAL + "|" + INDUSTRIAL + "|" + AGRICULTURAL + "|" + MIXED;

    /** Validation message paired with {@link #PATTERN}. */
    public static final String PATTERN_MESSAGE =
            "must be residential, commercial, industrial, agricultural or mixed";
}
