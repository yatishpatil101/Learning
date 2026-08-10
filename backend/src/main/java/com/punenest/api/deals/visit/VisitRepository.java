package com.punenest.api.deals.visit;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Reads over {@code visits}. Every finder here is shaped to hit the V4 indexes
 * ({@code idx_visits_visitor}, {@code idx_visits_property}).
 */
public interface VisitRepository extends JpaRepository<Visit, UUID> {

    /**
     * One page of the caller's own visits (visitor surface), newest first. Hits
     * {@code idx_visits_visitor_created} (V47), which carries the sort.
     */
    Page<Visit> findByVisitorIdOrderByCreatedAtDesc(UUID visitorId, Pageable pageable);

    /**
     * One page of the visits against a set of the caller's listings (owner surface), newest first.
     * Hits {@code idx_visits_property_created} (V47).
     */
    Page<Visit> findByPropertyIdInOrderByCreatedAtDesc(java.util.Collection<UUID> propertyIds,
                                                       Pageable pageable);

    /**
     * Duplicate-prevention probe: does this visitor already have a live (scheduled or confirmed)
     * visit on this property? The DB partial unique index {@code uq_visits_live_per_user_property}
     * is the real guarantee; this is the clean-error-path check.
     */
    @Query("select v from Visit v where v.visitorId = :visitorId and v.propertyId = :propertyId " +
            "and v.status in ('scheduled', 'confirmed')")
    Optional<Visit> findLiveByVisitorAndProperty(@Param("visitorId") UUID visitorId,
                                                  @Param("propertyId") UUID propertyId);

    /**
     * Has this visitor completed a visit to this property? Backs the review-eligibility port
     * ({@code common.trust.PropertyExperience}) — the anti-fake-review rule.
     *
     * <p>Only {@code completed} counts. A booked-but-not-attended visit is an intention, and letting
     * an intention earn a "Visited" badge would make the badge free: anyone could schedule a visit
     * they never attend and review the flat from their sofa. Hits {@code idx_visits_visitor}.
     */
    boolean existsByVisitorIdAndPropertyIdAndStatus(UUID visitorId, UUID propertyId, String status);
}
