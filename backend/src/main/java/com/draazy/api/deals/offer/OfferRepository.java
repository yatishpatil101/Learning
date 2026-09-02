package com.draazy.api.deals.offer;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Reads over {@code offers}. Every finder here is shaped to hit V5 indexes
 * ({@code idx_offers_from}, {@code idx_offers_property}).
 */
public interface OfferRepository extends JpaRepository<Offer, UUID> {

    /**
     * One page of the caller's own offers, newest first. Hits {@code idx_offers_from_created} (V47),
     * which carries the sort so the top page is a range scan rather than a sort of every row the
     * caller has ever written.
     */
    Page<Offer> findByFromUserIdOrderByCreatedAtDesc(UUID fromUserId, Pageable pageable);

    /**
     * One page of the offers against a set of the caller's listings, newest first. Hits
     * {@code idx_offers_property_created} (V47).
     */
    Page<Offer> findByPropertyIdInOrderByCreatedAtDesc(Collection<UUID> propertyIds,
                                                       Pageable pageable);

    /**
     * Duplicate-prevention probe: does this user already have a live (pending or countered) offer
     * on this property? The DB partial unique index {@code uq_offers_live_per_user_property} is the
     * real guarantee; this is the clean-error-path check.
     */
    @Query("select o from Offer o where o.fromUserId = :userId and o.propertyId = :propertyId " +
            "and o.status in ('pending', 'countered')")
    Optional<Offer> findLiveByUserAndProperty(@Param("userId") UUID userId,
                                               @Param("propertyId") UUID propertyId);
}
