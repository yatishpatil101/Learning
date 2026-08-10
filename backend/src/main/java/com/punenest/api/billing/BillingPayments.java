package com.punenest.api.billing;

import com.punenest.api.billing.boost.BoostService;
import com.punenest.api.billing.plan.SubscriptionService;
import java.time.Instant;
import org.springframework.stereotype.Service;

/**
 * The single entry point the payment webhook uses to settle a billing purchase.
 *
 * <p>A subscription and a boost are both bought against a gateway order, so both need the same
 * callback. Without this the webhook handler would have to know about two services in two
 * sub-packages and grow a third line every time billing learns to sell something else; with it, the
 * handler makes one call and billing decides internally what that order was for.
 *
 * <p><strong>Order ids are not namespaced, so both are asked.</strong> Each service looks the id up
 * in its own table and returns immediately if it does not own it — the same "unknown order is a
 * no-op" rule the rent path already follows, which is what keeps a redelivered or unrelated callback
 * harmless.
 *
 * <p>The two are exposed as separate settlements rather than one combined call so the webhook's
 * per-handler isolation covers each of them. Combining them here put subscriptions and boosts back
 * on a shared failure path — a throwing subscription meant the boost was never asked, the webhook
 * still answered 200, and the provider never retried — which is precisely the bug that isolation
 * exists to prevent, reproduced one level down.
 */
@Service
public class BillingPayments {

    private final SubscriptionService subscriptions;
    private final BoostService boosts;

    public BillingPayments(SubscriptionService subscriptions, BoostService boosts) {
        this.subscriptions = subscriptions;
        this.boosts = boosts;
    }

    /**
     * Settle a subscription against this gateway order, if it owns it.
     *
     * @param orderId the provider's {@code order_id}
     * @param paid    whether the money actually moved
     * @param paidAt  when the provider says it settled
     * @return whether a subscription owned the order
     */
    public boolean settleSubscription(String orderId, boolean paid, Instant paidAt) {
        return subscriptions.applyWebhookOutcome(orderId, paid, paidAt);
    }

    /**
     * Settle a boost against this gateway order, if it owns it.
     *
     * @param orderId the provider's {@code order_id}
     * @param paid    whether the money actually moved
     * @param paidAt  when the provider says it settled
     * @return whether a boost owned the order
     */
    public boolean settleBoost(String orderId, boolean paid, Instant paidAt) {
        return boosts.applyWebhookOutcome(orderId, paid, paidAt);
    }
}
