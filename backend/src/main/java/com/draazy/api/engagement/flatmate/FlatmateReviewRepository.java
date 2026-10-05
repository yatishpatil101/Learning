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

public interface FlatmateReviewRepository extends JpaRepository<FlatmateReview, UUID> {

    @Query("select r from FlatmateReview r where (:status is null or r.status = :status) "
            + "and (:flagged is null or r.flagForReview = :flagged) "
            + "and not exists (select 1 from FlatmateRoom fr where fr.id = r.roomId and fr.archived = true) "
            + "and not exists (select 1 from FlatmateGroup fg where fg.id = r.groupId and fg.archived = true)")
    Page<FlatmateReview> findForQueue(@Param("status") String status,
            @Param("flagged") Boolean flagged, Pageable pageable);

    /** One review per target — a host cannot queue the same flat twice for a second opinion. */
    Optional<FlatmateReview> findByRoomId(UUID roomId);

    Optional<FlatmateReview> findByGroupId(UUID groupId);

    List<FlatmateReview> findByGroupIdIn(Collection<UUID> groupIds);

    List<FlatmateReview> findByRoomIdIn(Collection<UUID> roomIds);

    /** A null {@code validTill} deliberately never matches — "no end date recorded" is not expiry.
     * Literal status because JPQL cannot dereference {@link FlatmateVocabulary#STATUS_APPROVED}. */
    @Query("select r from FlatmateReview r "
            + "where r.status = 'approved' and r.agreement.validTill < :on")
    List<FlatmateReview> findLapsedApprovals(@Param("on") LocalDate on);

    @Query("select r from FlatmateReview r "
            + "where r.status = 'pending' and r.tier = 'tenant' and r.ownerConsent = true")
    List<FlatmateReview> findConsentedTenantBacklog();
}
