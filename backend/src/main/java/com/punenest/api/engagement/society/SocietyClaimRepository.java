package com.punenest.api.engagement.society;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Society claims: the ops queue, and the "who administers this" lookup the hub runs on load. */
public interface SocietyClaimRepository extends JpaRepository<SocietyClaim, UUID> {

    /**
     * The one live claim on a society, if any.
     *
     * <p>{@code ux_society_claims_live} guarantees at most one row across both live statuses, which
     * is why this can be an {@code Optional} rather than a list — the constraint, not this method,
     * is what makes it true.
     */
    @Query("""
            select c from SocietyClaim c
            where c.societyId = :societyId
              and c.status in ('pending', 'approved')
            """)
    Optional<SocietyClaim> findLiveClaim(@Param("societyId") UUID societyId);

    /** The ops queue, oldest first — a claim that has waited longest is the one to decide next. */
    @Query("""
            select c from SocietyClaim c
            where (:status is null or c.status = :status)
            order by c.createdAt asc
            """)
    Page<SocietyClaim> queue(@Param("status") String status, Pageable pageable);

    /**
     * Every society this user administers.
     *
     * <p>Used to answer "am I the admin here" without a per-society round trip on a page that shows
     * several. Approved-only: a pending claim grants nothing, which is the entire point of ops
     * deciding it.
     */
    @Query("select c.societyId from SocietyClaim c where c.claimedBy = :userId and c.status = 'approved'")
    List<UUID> societiesAdministeredBy(@Param("userId") UUID userId);
}
