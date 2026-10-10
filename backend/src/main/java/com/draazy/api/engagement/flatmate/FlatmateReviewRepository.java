package com.draazy.api.engagement.flatmate;

import java.time.Instant;
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

    String QUEUE_WHERE = "from FlatmateReview r where (:status is null or r.status = :status) "
            + "and (:flagged is null or r.flagForReview = :flagged) "
            + "and not exists (select 1 from FlatmateRoom fr where fr.id = r.roomId and fr.archived = true) "
            + "and not exists (select 1 from FlatmateGroup fg where fg.id = r.groupId and fg.archived = true)";

    /** Columns, not entities: the agreement document is JSONB of up to 3 MB and a queue card never shows it. */
    @Query(value = "select r.id as id, r.kind as kind, r.roomId as roomId, r.groupId as groupId, "
            + "r.hostId as hostId, r.address as address, r.tier as tier, r.flagForReview as flagForReview, "
            + "r.ownerConsent as ownerConsent, r.createdAt as createdAt " + QUEUE_WHERE,
            countQuery = "select count(r) " + QUEUE_WHERE)
    Page<QueueRow> findForQueue(@Param("status") String status,
            @Param("flagged") Boolean flagged, Pageable pageable);

    interface QueueRow {
        UUID getId();

        String getKind();

        UUID getRoomId();

        UUID getGroupId();

        UUID getHostId();

        String getAddress();

        String getTier();

        boolean getFlagForReview();

        boolean getOwnerConsent();

        Instant getCreatedAt();
    }

    /** Pending claims whose post is not itself awaiting moderation: the desk shows those as a card of
     * their own, where a claim on an awaiting post shares the post's card. */
    @Query("select count(r) from FlatmateReview r where r.status = 'pending' "
            + "and not exists (select 1 from FlatmateRoom fr where fr.id = r.roomId and fr.archived = true) "
            + "and not exists (select 1 from FlatmateGroup fg where fg.id = r.groupId and fg.archived = true) "
            + "and not exists (select 1 from FlatmateRoom fr where fr.id = r.roomId "
            + "and (fr.modStatus = 'pending' or fr.recheck.requestedAt is not null)) "
            + "and not exists (select 1 from FlatmateGroup fg where fg.id = r.groupId "
            + "and (fg.modStatus = 'pending' or fg.recheck.requestedAt is not null))")
    long countBadgeOnlyPending();
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
