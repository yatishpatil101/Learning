package com.punenest.api.engagement.notification;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Notification access. Every query is user-scoped (invariant 1). The composite index
 * {@code idx_notifications_user_created} backs the paged read (newest first).
 */
public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    /** Paged read, newest first — the only paged endpoint in this slice. */
    Page<Notification> findByUserId(UUID userId, Pageable pageable);

    /** Look up one notification scoped to its owner — the guard behind dismiss (invariant 1). */
    Optional<Notification> findByIdAndUserId(UUID id, UUID userId);

    /** Mark specific notifications read — only the caller's own rows (invariant 2). */
    @Modifying
    @Query("update Notification n set n.read = true where n.userId = :userId and n.id in :ids")
    int markRead(@Param("userId") UUID userId, @Param("ids") Collection<UUID> ids);

    /** Mark all of the caller's notifications read (invariant 3). */
    @Modifying
    @Query("update Notification n set n.read = true where n.userId = :userId and n.read = false")
    int markAllRead(@Param("userId") UUID userId);
}
