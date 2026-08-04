package com.punenest.api.engagement.flatmate;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads over {@code flatmate_group_applications} (V29). */
public interface FlatmateGroupApplicationRepository
        extends JpaRepository<FlatmateGroupApplication, UUID> {

    /**
     * The admin board, newest first, paged.
     *
     * <p>Backed by {@code idx_flatmate_group_applications_created (created_at DESC)}, added in V30
     * alongside this signature: V29 indexed {@code (listing_id, created_at)} and
     * {@code (mod_status, created_at)}, neither of which serves an unfiltered board, so the sort
     * was a full-table one. Paging without the index would have kept the sort and merely thrown
     * most of its result away.
     */
    Page<FlatmateGroupApplication> findByOrderByCreatedAtDesc(Pageable pageable);

    /** The owner's view: applications on one listing. */
    List<FlatmateGroupApplication> findByListingIdOrderByCreatedAtDesc(UUID listingId);
}
