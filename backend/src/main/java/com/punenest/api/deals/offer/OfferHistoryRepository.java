package com.punenest.api.deals.offer;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Reads over {@code offer_history}. The index {@code idx_offer_history_offer} backs the
 * per-offer trail lookup.
 */
public interface OfferHistoryRepository extends JpaRepository<OfferHistory, UUID> {

    /** The negotiation trail for one offer, chronological. */
    List<OfferHistory> findByOfferIdOrderByAtAsc(UUID offerId);

    /** Batch load: the trail for many offers at once (N+1 safety for list reads). */
    List<OfferHistory> findByOfferIdInOrderByAtAsc(Collection<UUID> offerIds);
}
