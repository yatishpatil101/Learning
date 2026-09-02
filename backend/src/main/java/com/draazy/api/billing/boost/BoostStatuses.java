package com.draazy.api.billing.boost;

/**
 * The {@code Boost.status} vocabulary (contract enum; {@code boosts.status} CHECK, V8 extended by
 * V23). Constants rather than an enum per {@code api-standards.md} §7.1.
 *
 * <p>{@link #PENDING} was added by spec fix S51 — an {@code active} boost that was never paid for
 * is free promotion, and {@code 201} only means the order was created.
 */
public final class BoostStatuses {

    private BoostStatuses() {
    }

    /** Checkout opened, money not yet confirmed. The listing is not promoted. */
    public static final String PENDING = "pending";

    /** Paid and inside its window. */
    public static final String ACTIVE = "active";

    /** The window closed — or never opened, because payment failed. */
    public static final String EXPIRED = "expired";
}
