package com.draazy.api.billing.boost;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
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

    /**
     * How many unpaid boost orders this buyer is already holding open (D160).
     *
     * <p>Counted by buyer rather than by listing on purpose: the cap is one outstanding order per
     * <em>person</em>, so an owner with three listings cannot open three live gateway orders at
     * once. See {@code uq_boosts_open_unpaid} (V45), which is what holds this under concurrency —
     * this count is an unlocked read over rows that do not exist yet and two racers both see zero.
     */
    long countByBuyerIdAndStatus(UUID buyerId, String status);

    /**
     * Checkouts opened before {@code cutoff} and still unpaid — the sweep's input (D161).
     *
     * <p>The status filter is also the never-paid proof: a settled payment opens the window
     * ({@code active}) and a refused one closes it ({@code expired}), so a row still {@code pending}
     * is one no money has arrived for.
     *
     * <p>Ordered oldest-first and taken a {@code batch} at a time, for the reasons set out on
     * {@code SubscriptionRepository}'s equivalent: the order decides which rows a bounded run
     * retires, and the bound keeps a post-outage backlog — and any version conflict inside it —
     * from taking one transaction down with it.
     */
    List<Boost> findByStatusAndCreatedAtBeforeOrderByCreatedAtAsc(String status, Instant cutoff,
            Limit batch);
}
