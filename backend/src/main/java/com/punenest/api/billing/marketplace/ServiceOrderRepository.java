package com.punenest.api.billing.marketplace;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

/** The caller's own service orders. Serves {@code idx_service_orders_user_created} (V23). */
public interface ServiceOrderRepository extends JpaRepository<ServiceOrder, UUID> {

    /**
     * The caller's orders, newest first, capped.
     *
     * <p>The cap is what makes the bare array safe: {@code api-standards.md} §5.1 returns a
     * one-user collection unpaged, but only on the condition that it is explicitly bounded rather
     * than assumed small.
     */
    List<ServiceOrder> findByUserIdOrderByCreatedAtDesc(UUID userId, Limit limit);

    /** Replays a client's {@code Idempotency-Key}. Unique per user (V23). */
    Optional<ServiceOrder> findByUserIdAndIdempotencyKey(UUID userId, String idempotencyKey);
}
