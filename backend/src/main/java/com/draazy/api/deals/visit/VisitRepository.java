package com.draazy.api.deals.visit;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Every finder is shaped to hit the visit indexes ({@code idx_visits_visitor}, {@code idx_visits_property}). */
public interface VisitRepository extends JpaRepository<Visit, UUID> {

    /** Hits {@code idx_visits_visitor_created}, which carries the sort. */
    Page<Visit> findByVisitorIdOrderByCreatedAtDesc(UUID visitorId, Pageable pageable);

    Page<Visit> findByVisitorIdAndPropertyIdOrderByCreatedAtDesc(
            UUID visitorId, UUID propertyId, Pageable pageable);

    /** Hits {@code idx_visits_property_created}, which carries the sort. */
    Page<Visit> findByPropertyIdInOrderByCreatedAtDesc(java.util.Collection<UUID> propertyIds,
                                                       Pageable pageable);

    /** Every visit on the platform, newest first — the back office's demand board. */
    Page<Visit> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /** The same board filtered to one status. */
    Page<Visit> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);

    /** Clean-error-path check; the partial unique index {@code uq_visits_live_per_user_property} guarantees it. */
    @Query("select v from Visit v where v.visitorId = :visitorId and v.propertyId = :propertyId " +
            "and v.status in ('scheduled', 'confirmed')")
    Optional<Visit> findLiveByVisitorAndProperty(@Param("visitorId") UUID visitorId,
                                                  @Param("propertyId") UUID propertyId);

    /** Only {@code completed} counts: a booked visit is an intention, and counting it would let anyone
     * earn a "Visited" badge without attending. */
    boolean existsByVisitorIdAndPropertyIdAndStatus(UUID visitorId, UUID propertyId, String status);
}
