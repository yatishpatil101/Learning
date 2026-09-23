package com.draazy.api.engagement.flatmate;

import java.time.LocalDate;
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

    /** Both predicates stay in the query so paging is not taken before one of them runs. Ordering
     * comes from the {@code Pageable}; a literal {@code order by} here would emit two clauses. */
    @Query("select r from FlatmateReview r where (:status is null or r.status = :status) "
            + "and (:flagged is null or r.flagForReview = :flagged)")
    Page<FlatmateReview> findForQueue(@Param("status") String status,
            @Param("flagged") Boolean flagged, Pageable pageable);

    /** One review per target — a host cannot queue the same flat twice for a second opinion. */
    Optional<FlatmateReview> findByRoomId(UUID roomId);

    Optional<FlatmateReview> findByGroupId(UUID groupId);

    /** The reviews attached to a window of groups, in one read — the card feeds page twenty. */
    List<FlatmateReview> findByGroupIdIn(Collection<UUID> groupIds);

    /** The reviews attached to a window of rooms, in one read — see {@link #findByGroupIdIn}. */
    List<FlatmateReview> findByRoomIdIn(Collection<UUID> roomIds);

    /** A null {@code validTill} deliberately never matches — "no end date recorded" is not expiry.
     * Literal status because JPQL cannot dereference {@link FlatmateVocabulary#STATUS_APPROVED}. */
    @Query("select r from FlatmateReview r "
            + "where r.status = 'approved' and r.agreement.validTill < :on")
    List<FlatmateReview> findLapsedApprovals(@Param("on") LocalDate on);

    /** Candidates for the Draazy-agreement sweep. Unpaged: the queue is small and the sweep has to
     * consider all of it. Literals for the same JPQL reason as {@link #findLapsedApprovals}. */
    @Query("select r from FlatmateReview r "
            + "where r.status = 'pending' and r.tier = 'tenant' and r.ownerConsent = true")
    List<FlatmateReview> findConsentedTenantBacklog();
}
