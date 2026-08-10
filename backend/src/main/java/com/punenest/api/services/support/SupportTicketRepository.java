package com.punenest.api.services.support;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** The caller's own tickets, and the paged platform-wide queue ops triages (D51). */
public interface SupportTicketRepository extends JpaRepository<SupportTicket, UUID> {

    /** The caller's own tickets. Serves {@code idx_support_tickets_user_created} (V22). */
    List<SupportTicket> findByUserIdOrderByCreatedAtDesc(UUID userId);

    /**
     * The whole platform's support traffic, newest first. Serves
     * {@code idx_support_tickets_created} (V53) — the sort this table had never been indexed for,
     * because until D51 every read of it was scoped to one user.
     */
    Page<SupportTicket> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /**
     * The same queue narrowed to tickets with a customer message nobody has read — the working view.
     * Serves the partial {@code idx_support_tickets_awaiting_reply} (V53).
     *
     * <p>Derived rather than one {@code @Query} taking a nullable flag: that shape puts
     * {@code (:flag is null or t.staffUnread = :flag)} into the predicate, and Postgres cannot use a
     * partial index behind an OR it has to evaluate row by row. Two methods, two plans, both
     * index-served.
     */
    Page<SupportTicket> findByStaffUnreadTrueOrderByCreatedAtDesc(Pageable pageable);

    /**
     * The complement — tickets the desk has caught up on. Nothing narrows to this deliberately, but
     * {@code ?awaitingReply=false} has to mean what it says rather than being dropped on the floor.
     *
     * <p>No index of its own: the partial one covers the minority side, and this side is most of the
     * table, so walking {@code idx_support_tickets_created} newest-first and skipping the few
     * flagged rows fills a page almost immediately.
     */
    Page<SupportTicket> findByStaffUnreadFalseOrderByCreatedAtDesc(Pageable pageable);
}
