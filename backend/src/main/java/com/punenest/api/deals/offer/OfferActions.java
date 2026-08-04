package com.punenest.api.deals.offer;

/**
 * What a party may do with an offer they have received — the {@code OfferResponse.action}
 * vocabulary.
 *
 * <p>Sits beside {@link OfferStatuses}, which is the <em>result</em> of these actions:
 * {@code accept} produces {@code accepted}, {@code decline} produces {@code declined},
 * {@code counter} produces {@code countered}. They are deliberately two vocabularies rather than one
 * — an action is a verb the client sends, a status is a noun the row holds, and only three of the
 * statuses are reachable by an action at all ({@code expired} and {@code withdrawn} are not).
 *
 * <p><strong>Why it moved here.</strong> The three values used to be constants on
 * {@code OfferRespondRequest} — a request DTO — which made {@code OfferService} import a wire schema
 * in order to name a domain concept, and left the {@code @Pattern} regex spelling them out a second
 * time by hand. Composing the pattern from the constants means the accepted input set and the
 * dispatch in {@code OfferService.statusFor} cannot drift apart (tech-debt D24).
 */
public final class OfferActions {

    private OfferActions() {
    }

    /** Take the offer as it stands. Owner only — a bidder cannot accept their own offer. */
    public static final String ACCEPT = "accept";

    /** Refuse without a number. Owner only. */
    public static final String DECLINE = "decline";

    /** Reply with a different amount. The one action either party may take, which is why it is the
     * exception in {@code OfferService}'s owner check. */
    public static final String COUNTER = "counter";

    /**
     * Bean-Validation regex accepting exactly the three actions. Must be a compile-time constant to
     * be usable in {@code @Pattern}, so it is composed from the constants above rather than
     * hand-written.
     */
    public static final String PATTERN = "^(" + ACCEPT + "|" + DECLINE + "|" + COUNTER + ")$";

    /** Validation message paired with {@link #PATTERN}. */
    public static final String PATTERN_MESSAGE = "must be accept, decline or counter";
}
