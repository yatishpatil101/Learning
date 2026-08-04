package com.punenest.api.deals.deal;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
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

    /** All deal rows for a set of property ids — the batch load for {@code GET /me/deals}. */
    List<Deal> findByPropertyIdIn(Collection<UUID> propertyIds);
}
