package com.draazy.api.deals.finalization;

/**
 * The finalization-request status vocabulary — the four values
 * {@code finalization_requests.status} may physically hold, mirrored from the V5 CHECK constraint
 * and the OpenAPI {@code FinalizationRequest.status} enum.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1. Every value
 * is traced to both:
 * <ul>
 *   <li>V5: {@code CHECK (status IN ('pending','accepted','declined','cancelled'))}</li>
 *   <li>OpenAPI: {@code FinalizationRequest.status} enum</li>
 * </ul>
 *
 * <p>The transition rule is expressed in {@link #canTransition(String, String)} so that illegal
 * moves produce a clean 409, never a 500.
 */
public final class FinalizationStatuses {

    private FinalizationStatuses() {
    }

    /** The initiator has requested; awaiting the counterparty's decision. */
    public static final String PENDING = "pending";

    /** The counterparty accepted. Terminal — triggers deal close and sibling auto-decline. */
    public static final String ACCEPTED = "accepted";

    /** The counterparty declined, or the request was auto-declined on sibling acceptance. Terminal. */
    public static final String DECLINED = "declined";

    /** The initiator cancelled their own request. Terminal. */
    public static final String CANCELLED = "cancelled";

    /**
     * Whether {@code current} may move to {@code next}. Legal transitions:
     * <ul>
     *   <li>{@code pending → accepted}</li>
     *   <li>{@code pending → declined}</li>
     *   <li>{@code pending → cancelled}</li>
     * </ul>
     * All of {@code accepted}, {@code declined}, and {@code cancelled} are terminal.
     */
    public static boolean canTransition(String current, String next) {
        if (PENDING.equals(current)) {
            return ACCEPTED.equals(next) || DECLINED.equals(next) || CANCELLED.equals(next);
        }
        return false;
    }
}
