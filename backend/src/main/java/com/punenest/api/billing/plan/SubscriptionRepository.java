package com.punenest.api.billing.plan;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** The caller's subscriptions, and the webhook's lookup by gateway order id. */
public interface SubscriptionRepository extends JpaRepository<Subscription, UUID> {

    /**
     * The caller's subscriptions, newest first. Serves {@code idx_subscriptions_user_started} (V23).
     *
     * <p>Returns the list rather than one row because the current subscription is "the newest live
     * one" and the filter is a domain rule ({@link SubscriptionStatuses#isLive}) rather than a
     * column value — encoding the status set into a derived query name would put the vocabulary in
     * two places.
     */
    List<Subscription> findByUserIdOrderByStartedAtDesc(UUID userId);

    /** The payment webhook's key. Unique in the DB (V23). */
    Optional<Subscription> findByPaymentRef(String paymentRef);

    /** Replays a client's {@code Idempotency-Key}. Unique per user (V23). */
    Optional<Subscription> findByUserIdAndIdempotencyKey(UUID userId, String idempotencyKey);
}
