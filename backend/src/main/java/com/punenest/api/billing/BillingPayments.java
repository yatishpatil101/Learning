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
     * Settle whatever billing purchase this gateway order paid for, if any.
     *
     * @param orderId the provider's {@code order_id}
     * @param paid    whether the money actually moved
     * @param paidAt  when the provider says it settled
     */
    public void applyWebhookOutcome(String orderId, boolean paid, Instant paidAt) {
        subscriptions.applyWebhookOutcome(orderId, paid, paidAt);
        boosts.applyWebhookOutcome(orderId, paid, paidAt);
    }
}
