package com.draazy.api.deals.deal;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Access to the {@code deals} table. Serves both the deals feature (full lifecycle) and the
 * offers feature (the "is there a closed deal?" check that blocks new offers).
 *
 * <p>Replaces the earlier read-only {@code DealRef}/{@code DealRepository} that A1 created as
 * a minimal projection. Now that the deals feature exists, this is the single definition.
 */
public interface DealRepository extends JpaRepository<Deal, UUID> {

    /** The deal row for a given property, if one exists. Hits {@code uq_deals_property}. */
    Optional<Deal> findByPropertyId(UUID propertyId);

    /** Does this property have a closed deal? If so, new offers are blocked (409). */
    @Query("select d from Deal d where d.propertyId = :propertyId and d.status = 'closed'")
    Optional<Deal> findClosedByPropertyId(@Param("propertyId") UUID propertyId);

    /**
     * One page of deal rows for a set of property ids — the batch load for {@code GET /me/deals}.
     *
     * <p>Ordered newest-first <em>in the query</em> rather than by a client sort: {@code /me/deals}
     * publishes no {@code sort} parameter, and a page without a total order is not a page — the
     * same row can appear twice or not at all across two requests. Hits
     * {@code idx_deals_property_created} (V47).
     */
    Page<Deal> findByPropertyIdInOrderByCreatedAtDesc(Collection<UUID> propertyIds,
                                                      Pageable pageable);

    /** Every deal on the platform, newest first — the back office's funnel board. */
    Page<Deal> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /** The same board filtered to one status. */
    Page<Deal> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);
}
