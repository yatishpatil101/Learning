package com.punenest.api.billing.boost;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Boosts, by gateway order id and by client retry key. */
public interface BoostRepository extends JpaRepository<Boost, UUID> {

    /** The payment webhook's key. Unique in the DB (V23). */
    Optional<Boost> findByPaymentRef(String paymentRef);

    /** Replays a client's {@code Idempotency-Key}, scoped to the listing being boosted (V23). */
    Optional<Boost> findByPropertyIdAndIdempotencyKey(UUID propertyId, String idempotencyKey);

    /**
     * Every boost ever bought for a listing, newest first.
     *
     * <p>Ordered rather than filtered to {@code active} because "is this listing boosted right now"
     * is not the only question the owner has — a window that failed to open, or one that has
     * expired, is exactly what someone looking at this screen is trying to understand. The caller
     * picks; the repository does not decide on its behalf.
     */
    List<Boost> findByPropertyIdOrderByCreatedAtDesc(UUID propertyId);
}
