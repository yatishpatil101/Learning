package com.punenest.api.billing.plan;

import java.util.Set;

/**
 * The {@code Subscription.status} vocabulary (contract enum; {@code subscriptions.status} CHECK,
 * V8 extended by V23). Per {@code api-standards.md} §7.1 these are constants, not an enum: they are
 * simultaneously database values and wire values.
 *
 * <p>{@link #PENDING} was added by spec fix S50 — see {@link Subscription} for why a subscription
 * has to be representable before it is paid for.
 *
 * <p>{@link #EXPIRED} is produced by {@code SubscriptionSweep} once a term elapses (D57).
 * {@link #PAST_DUE} is still declared-and-unproduced: it means "renewal was attempted and the money
 * did not arrive", which cannot happen while every plan is a one-off purchase with nothing to
 * retry. Declared rather than omitted so the reader can see the intended shape, and deliberately
 * not repurposed as a grace period — a grace window nobody has specified would be an invented
 * policy that quietly gives away paid benefits.
 */
public final class SubscriptionStatuses {

    private SubscriptionStatuses() {
    }

    /** Checkout opened, money not yet confirmed. Carries no plan benefits. */
    public static final String PENDING = "pending";

    /** Paid and within its term. */
    public static final String ACTIVE = "active";

    /** Renewal failed; benefits retained during the grace window. Not yet produced — see above. */
    public static final String PAST_DUE = "past-due";

    /** Ended early — abandoned at checkout, or superseded by an upgrade. */
    public static final String CANCELLED = "cancelled";

    /** Term elapsed without renewal. Written by the D57 sweep; also decided live on every read. */
    public static final String EXPIRED = "expired";

    /** The states that actually entitle a user to the plan's benefits. */
    private static final Set<String> ENTITLED = Set.of(ACTIVE, PAST_DUE);

    /** The states in which a subscription is still the user's, entitling or not. */
    private static final Set<String> LIVE = Set.of(PENDING, ACTIVE, PAST_DUE);

    /**
     * Whether {@code status} grants the plan's benefits.
     *
     * <p>{@link #PENDING} does not. Money has not moved, so nothing has been bought — this is the
     * distinction that stops an abandoned checkout from reading as an entitlement.
     */
    public static boolean isEntitling(String status) {
        return ENTITLED.contains(status);
    }

    /**
     * Whether {@code status} is one a user still holds — as opposed to a historical row.
     *
     * <p>{@link #PENDING} counts as held so that a user with no other subscription can still find
     * and resume an order they already created. It does <em>not</em> count as entitling; see
     * {@link #isEntitling} and {@code SubscriptionService.currentFor}.
     */
    public static boolean isLive(String status) {
        return LIVE.contains(status);
    }
}
