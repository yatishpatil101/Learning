package com.punenest.api.deals.offer;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Reads over {@code offers}. Every finder here is shaped to hit V5 indexes
 * ({@code idx_offers_from}, {@code idx_offers_property}).
 */
public interface OfferRepository extends JpaRepository<Offer, UUID> {

    /** The caller's own offers, newest first. Hits {@code idx_offers_from}. */
    List<Offer> findByFromUserIdOrderByCreatedAtDesc(UUID fromUserId);

    /** All offers against a set of the caller's listings, newest first. Hits {@code idx_offers_property}. */
    List<Offer> findByPropertyIdInOrderByCreatedAtDesc(Collection<UUID> propertyIds);

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
