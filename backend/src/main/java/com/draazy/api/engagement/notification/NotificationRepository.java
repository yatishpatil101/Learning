package com.draazy.api.engagement.notification;

import java.time.Instant;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Notification access. Every query is user-scoped (invariant 1). The composite index
 * {@code idx_notifications_user_created} backs the paged read (newest first). */
public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    @Query("select n from Notification n where n.userId = :userId "
            + "and (n.deliverAfter is null or n.deliverAfter <= :now) "
            + "and (n.read = false or n.createdAt >= :readCutoff)")
    Page<Notification> findDeliverable(@Param("userId") UUID userId,
            @Param("now") Instant now, @Param("readCutoff") Instant readCutoff, Pageable pageable);

    /** Non-null {@code deliverAfter} hides rows until the user's quiet window closes. */
    @Query("select count(n) from Notification n where n.userId = :userId and n.read = false "
            + "and (n.deliverAfter is null or n.deliverAfter <= :now)")
    long countUnreadDeliverable(@Param("userId") UUID userId, @Param("now") Instant now);

    /** Look up one notification scoped to its owner — the guard behind dismiss (invariant 1). */
    Optional<Notification> findByIdAndUserId(UUID id, UUID userId);

    /** Only mark deliverable rows, or quiet-hours notifications could surface already read. */
    @Modifying
    @Query("update Notification n set n.read = true where n.userId = :userId and n.id in :ids "
            + "and (n.deliverAfter is null or n.deliverAfter <= :now)")
    int markRead(@Param("userId") UUID userId, @Param("ids") Collection<UUID> ids,
            @Param("now") Instant now);

    /** Mark all of the caller's visible notifications read (invariant 3). See above. */
    @Modifying
    @Query("update Notification n set n.read = true where n.userId = :userId and n.read = false "
            + "and (n.deliverAfter is null or n.deliverAfter <= :now)")
    int markAllRead(@Param("userId") UUID userId, @Param("now") Instant now);

    @Modifying
    @Query("update Notification n set n.read = true "
            + "where n.userId = :userId and n.type = :type and n.link = :link and n.read = false")
    int markReadByTypeAndLink(@Param("userId") UUID userId, @Param("type") String type,
            @Param("link") String link);

    /** Release deferred rows when quiet hours are disabled after they were stamped. */
    @Modifying
    @Query("update Notification n set n.deliverAfter = null "
            + "where n.userId = :userId and n.deliverAfter is not null")
    int releaseDeferred(@Param("userId") UUID userId);

    @Modifying
    @Query("delete from Notification n where n.createdAt < :cutoff")
    int deleteCreatedBefore(@Param("cutoff") Instant cutoff);
}
