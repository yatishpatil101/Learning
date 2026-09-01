package com.punenest.api.engagement.flatmate;

import java.util.Collection;
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

    /**
     * The owner inbox: applications across every listing the caller holds, newest first, paged.
     *
     * <p>The {@code modStatus} filter is not cosmetic. An admin who removed a spam application must
     * not have thereby declined it — {@code status} stays {@code pending} — so the only thing that
     * can keep it off the owner's screen is this predicate. Passing the public set in from the
     * caller keeps the rule visible at the call site rather than buried in a derived name.
     *
     * <p>Backed by {@code idx_flatmate_group_applications (listing_id, created_at)} from V29.
     */
    Page<FlatmateGroupApplication> findByListingIdInAndModStatusInOrderByCreatedAtDesc(
            Collection<UUID> listingIds, Collection<String> modStatuses, Pageable pageable);

    /**
     * Has this group already applied to this listing?
     *
     * <p>Checked rather than relying on a unique constraint because the answer is a 409 with a
     * sentence, not a constraint-violation stack trace. A second application is not new
     * information: the owner already has the group's answer pending in front of them.
     */
    boolean existsByListingIdAndGroupId(UUID listingId, UUID groupId);
}
