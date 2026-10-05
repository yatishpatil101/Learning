package com.draazy.api.engagement.flatmate;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FlatmateGroupApplicationRepository
        extends JpaRepository<FlatmateGroupApplication, UUID> {

    /** Uses the unfiltered created-at index so the admin board does not sort the full table. */
    Page<FlatmateGroupApplication> findByOrderByCreatedAtDesc(Pageable pageable);

    Page<FlatmateGroupApplication> findByModStatusIn(Collection<String> modStatuses, Pageable pageable);

    List<FlatmateGroupApplication> findByListingIdOrderByCreatedAtDesc(UUID listingId);

    /** {@code modStatus} hides removed spam while leaving owner-facing status pending. */
    Page<FlatmateGroupApplication> findByListingIdInAndModStatusInOrderByCreatedAtDesc(
            Collection<UUID> listingIds, Collection<String> modStatuses, Pageable pageable);

    /** Check first so duplicate applications return the contract's 409 sentence. */
    boolean existsByListingIdAndGroupId(UUID listingId, UUID groupId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update FlatmateGroupApplication app
               set app.status = :status,
                   app.decidedAt = :decidedAt
             where app.id = :id
               and app.status = :pending
            """)
    int updateDecisionIfPending(@Param("id") UUID id,
                                @Param("pending") String pending,
                                @Param("status") String status,
                                @Param("decidedAt") java.time.Instant decidedAt);
}
