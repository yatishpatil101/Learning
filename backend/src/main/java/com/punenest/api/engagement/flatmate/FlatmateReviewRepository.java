package com.punenest.api.engagement.flatmate;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Reads over {@code flatmate_reviews} (V27) — the Ops agreement queue. */
public interface FlatmateReviewRepository extends JpaRepository<FlatmateReview, UUID> {

    /**
     * The queue as Ops reads it: oldest first, because the interesting end is the one waiting.
     *
     * <p><strong>One nullable-parameter query, replacing three derived finders.</strong> Both
     * filters used to be separate methods, and the caller picked one — so asking for
     * {@code status=pending&flagged=true} ran the status query and then re-filtered the result
     * <em>in Java</em>. That is invisible while the whole table is read into memory and wrong the
     * moment it is paged: the slice would be taken before the second predicate ran, giving short
     * pages and a {@code totalElements} counting rows the caller had excluded. Both predicates
     * belong in the query. Mirrors {@code ReviewRepository.findForModeration}.
     *
     * <p>Ordering is supplied by the {@code Pageable} rather than an {@code order by} clause here,
     * because a literal one plus a sorted pageable produces two {@code order by} clauses and
     * invalid SQL. Backed by {@code idx_flatmate_reviews_status (status, created_at)}.
     */
    @Query("select r from FlatmateReview r where (:status is null or r.status = :status) "
            + "and (:flagged is null or r.flagForReview = :flagged)")
    Page<FlatmateReview> findForQueue(@Param("status") String status,
            @Param("flagged") Boolean flagged, Pageable pageable);

    /** One review per target — a host cannot queue the same flat twice for a second opinion. */
    Optional<FlatmateReview> findByRoomId(UUID roomId);

    Optional<FlatmateReview> findByGroupId(UUID groupId);

    /**
     * The reviews attached to a window of groups, in one read.
     *
     * <p>The card-sized reads publish the verdict alongside the row it belongs to, so a page of
     * twenty groups would otherwise be twenty calls to {@link #findByGroupId}. Plural of the same
     * finder rather than a projection, because the caller reduces these to a status string and a
     * projection would fix that decision here.
     */
    List<FlatmateReview> findByGroupIdIn(Collection<UUID> groupIds);

    /** The reviews attached to a window of rooms, in one read — see {@link #findByGroupIdIn}. */
    List<FlatmateReview> findByRoomIdIn(Collection<UUID> roomIds);
}
