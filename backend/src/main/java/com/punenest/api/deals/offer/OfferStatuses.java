package com.punenest.api.deals.offer;

/**
 * The offer status vocabulary — the five values {@code offers.status} may physically hold,
 * mirrored from the V5 CHECK constraint and the OpenAPI {@code Offer.status} enum.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1. Every value
 * is traced to both:
 * <ul>
 *   <li>V5: {@code CHECK (status IN ('pending','countered','accepted','declined','withdrawn'))}</li>
 *   <li>OpenAPI: {@code Offer.status} enum</li>
 * </ul>
 *
 * <p>The transition rule is expressed in {@link #canTransition(String, String)} so that illegal
 * moves produce a clean 409, never a 500.
 */
public final class OfferStatuses {

    private OfferStatuses() {
    }

    /** The buyer has submitted; awaiting the owner's decision. */
    public static final String PENDING = "pending";

    /** Either side has countered with a new amount. */
    public static final String COUNTERED = "countered";

    /** The owner accepted the offer. Terminal. */
    public static final String ACCEPTED = "accepted";

    /** The owner (or buyer) declined. Terminal. */
    public static final String DECLINED = "declined";

    /** The buyer withdrew their own offer. Terminal. */
    public static final String WITHDRAWN = "withdrawn";

    /** Direction constants for {@code offer_history.by}. */
    public static final String BY_BUYER = "buyer";
    public static final String BY_OWNER = "owner";

    /**
     * Whether {@code current} may move to {@code next}. Legal transitions:
     * <ul>
     *   <li>{@code pending → countered|accepted|declined|withdrawn}</li>
     *   <li>{@code countered → countered|accepted|declined|withdrawn}</li>
     * </ul>
     * All of {@code accepted}, {@code declined}, and {@code withdrawn} are terminal.
     */
    public static boolean canTransition(String current, String next) {
        if (PENDING.equals(current) || COUNTERED.equals(current)) {
            return COUNTERED.equals(next)
                    || ACCEPTED.equals(next)
                    || DECLINED.equals(next)
                    || WITHDRAWN.equals(next);
        }
        return false;
    }
}
