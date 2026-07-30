package com.punenest.api.catalog.property;

/**
 * Transaction intent of a listing ({@code properties.deal}) and the price unit it implies.
 *
 * <p>Mirrors the OpenAPI {@code DealIntent} enum. The deal is a <em>foundation</em> field: changing it
 * reverts the listing to {@link PropertyStatus#PENDING}, because it changes what the price means.
 *
 * <p>{@link #priceUnitFor(String)} exists so that meaning lives in exactly one place. The
 * deal-to-price-unit rule was previously inlined as a ternary at both the create and the update call
 * site — two copies of a domain rule that must never disagree, or a rent listing would display a
 * lakh-scale figure as a monthly rent.
 *
 * <p>The values also back the {@code @Pattern} validation on the listing request records via
 * {@link #PATTERN}, so the accepted input set and the domain constants cannot drift apart.
 */
public final class DealIntent {

    private DealIntent() {
    }

    /** Sale. Price is the total consideration. */
    public static final String BUY = "buy";

    /** Rental. Price is the monthly rent. */
    public static final String RENT = "rent";

    /**
     * Bean-Validation regex accepting exactly the two intents. Must be a compile-time constant to be
     * usable in {@code @Pattern}, so it is composed from the constants above rather than hand-written.
     */
    public static final String PATTERN = BUY + "|" + RENT;

    /** Validation message paired with {@link #PATTERN}. */
    public static final String PATTERN_MESSAGE = "must be buy or rent";

    /** Price unit for a sale: the figure is the whole amount. */
    public static final String UNIT_TOTAL = "total";

    /** Price unit for a rental: the figure recurs monthly. */
    public static final String UNIT_PER_MONTH = "per-month";

    /**
     * The single definition of how a deal determines its price unit.
     *
     * @param deal the transaction intent; anything that is not {@link #RENT} is treated as a sale,
     *     which keeps a null/unknown value on the safer {@link #UNIT_TOTAL} side rather than
     *     silently advertising a sale price as a monthly rent
     * @return {@link #UNIT_PER_MONTH} for a rental, otherwise {@link #UNIT_TOTAL}
     */
    public static String priceUnitFor(String deal) {
        return RENT.equals(deal) ? UNIT_PER_MONTH : UNIT_TOTAL;
    }
}
