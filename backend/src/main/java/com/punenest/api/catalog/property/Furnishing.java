package com.punenest.api.catalog.property;

/**
 * Furnishing level of a listing ({@code properties.furnishing}) — what the tenant or buyer gets with
 * the walls.
 *
 * <p>Mirrors the OpenAPI {@code Furnishing} enum and the V3 {@code CHECK} constraint. Like
 * {@link PropertyPossession} the values are persisted verbatim and returned verbatim, so a rename is
 * simultaneously a migration and a breaking contract change.
 *
 * <p><strong>Why this class exists at all.</strong> The three values were written out as a literal
 * regex in {@code ListingCreate} and again in {@code ListingUpdate}, next to fields that already used
 * {@code DealIntent.PATTERN} and {@code PropertyPossession.PATTERN} — so the file itself showed both
 * the house style and the exception to it. Two hand-copied regexes are two places to forget when a
 * fourth level is added, and the compiler cannot tell you they have drifted (tech-debt D24).
 *
 * <p><strong>Nullable, and exact-match on search.</strong> {@code null} means "not stated", which is
 * genuinely different from {@code unfurnished} — an owner who left the field blank has not claimed
 * the flat is empty, and a {@code furnishing=unfurnished} search must not return them.
 */
public final class Furnishing {

    private Furnishing() {
    }

    /** Bare walls: no white goods, no beds, usually not even light fittings. */
    public static final String UNFURNISHED = "unfurnished";

    /** The Indian rental default — fans, lights, wardrobes and modular kitchen, no beds or sofas. */
    public static final String SEMI_FURNISHED = "semi-furnished";

    /** Move in with a suitcase: beds, sofas, white goods included. */
    public static final String FURNISHED = "furnished";

    /**
     * Bean-Validation regex accepting exactly the three levels. Must be a compile-time constant to be
     * usable in {@code @Pattern}, so it is composed from the constants above rather than
     * hand-written — the accepted input set and the domain constants therefore cannot drift apart.
     */
    public static final String PATTERN = UNFURNISHED + "|" + SEMI_FURNISHED + "|" + FURNISHED;

    /** Validation message paired with {@link #PATTERN}. */
    public static final String PATTERN_MESSAGE =
            "must be unfurnished, semi-furnished or furnished";
}
