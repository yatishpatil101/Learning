package com.draazy.api.deals.deal;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Serves both the deals lifecycle and the offers check that blocks new offers on a closed deal. */
public interface DealRepository extends JpaRepository<Deal, UUID> {

    /** The deal row for a given property, if one exists. Hits {@code uq_deals_property}. */
    Optional<Deal> findByPropertyId(UUID propertyId);

    /** Does this property have a closed deal? If so, new offers are blocked (409). */
    @Query("select d from Deal d where d.propertyId = :propertyId and d.status = 'closed'")
    Optional<Deal> findClosedByPropertyId(@Param("propertyId") UUID propertyId);

    /** Every deal on the platform, newest first — the back office's funnel board. */
    Page<Deal> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /** The same board filtered to one status. */
    Page<Deal> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);
}
