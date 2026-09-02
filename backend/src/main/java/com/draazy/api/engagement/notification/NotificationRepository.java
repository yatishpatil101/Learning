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

/**
 * Notification access. Every query is user-scoped (invariant 1). The composite index
 * {@code idx_notifications_user_created} backs the paged read (newest first).
 */
public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    /**
     * The inbox read: the caller's notifications that are due, newest first.
     *
     * <p>{@code deliverAfter is null} is the ordinary case — everything written outside a
     * quiet-hours window, and every row that predates V73. A non-null value hides the row until the
     * user's quiet window closes; see {@link Notification#getDeliverAfter()}.
     *
     * <p>Backed by {@code idx_notifications_user_deliverable (user_id, deliver_after, created_at
     * DESC)}. The sort still arrives on the {@link Pageable} rather than in the JPQL, because
     * {@link NotificationService} pins it there for both this and the contract's no-sort-parameter
     * rule.
     */
    @Query("select n from Notification n where n.userId = :userId "
            + "and (n.deliverAfter is null or n.deliverAfter <= :now)")
    Page<Notification> findDeliverable(@Param("userId") UUID userId,
            @Param("now") Instant now, Pageable pageable);

    /** Look up one notification scoped to its owner — the guard behind dismiss (invariant 1). */
    Optional<Notification> findByIdAndUserId(UUID id, UUID userId);

    /**
     * Mark specific notifications read — only the caller's own rows (invariant 2), and only rows
     * they could actually have seen.
     *
     * <p><strong>The deliverability predicate is not decoration.</strong> Without it, "mark all
     * read" at 03:00 would consume the notification written at 02:00 and deferred to 07:00: it
     * would surface at breakfast already read, sorted below everything written since, with no
     * unread affordance anywhere. That is the data-loss outcome deferral exists to avoid, reached
     * through the single action a user performs most often. Whatever hides a row from the read must
     * hide it from the mutations too.
     */
    @Modifying
    @Query("update Notification n set n.read = true where n.userId = :userId and n.id in :ids "
            + "and (n.deliverAfter is null or n.deliverAfter <= :now)")
    int markRead(@Param("userId") UUID userId, @Param("ids") Collection<UUID> ids,
            @Param("now") Instant now);

    /** Mark all of the caller's <em>visible</em> notifications read (invariant 3). See above. */
    @Modifying
    @Query("update Notification n set n.read = true where n.userId = :userId and n.read = false "
            + "and (n.deliverAfter is null or n.deliverAfter <= :now)")
    int markAllRead(@Param("userId") UUID userId, @Param("now") Instant now);

    /**
     * Release everything still being held for {@code userId}.
     *
     * <p>Called when the user turns quiet hours off. {@code deliverAfter} is computed once, at
     * write time, against the preferences then in force — so without this a user who is notified at
     * 23:00 and disables quiet hours at 23:30 still cannot see that notification until 07:00, with
     * no control anywhere that will release it. They have said "stop withholding my notifications";
     * this is the server doing as it was told.
     */
    @Modifying
    @Query("update Notification n set n.deliverAfter = null "
            + "where n.userId = :userId and n.deliverAfter is not null")
    int releaseDeferred(@Param("userId") UUID userId);
}
