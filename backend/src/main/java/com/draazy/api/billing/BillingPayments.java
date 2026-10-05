package com.draazy.api.billing;

import com.draazy.api.billing.plan.SubscriptionService;
import java.time.Instant;
import org.springframework.stereotype.Service;

@Service
public class BillingPayments {

    private final SubscriptionService subscriptions;

    public BillingPayments(SubscriptionService subscriptions) {
        this.subscriptions = subscriptions;
    }

    public boolean settleSubscription(String orderId, boolean paid, Instant paidAt) {
        return subscriptions.applyWebhookOutcome(orderId, paid, paidAt);
    }
    }
