package com.draazy.api.services.support;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

/** The caller's own tickets, and the paged platform-wide queue ops triages. */
public interface SupportTicketRepository extends JpaRepository<SupportTicket, UUID> {

    /** The caller's own tickets. Serves {@code idx_support_tickets_user_created} (V22). */
    List<SupportTicket> findByUserIdOrderByCreatedAtDesc(UUID userId);

    /** Newest-first platform queue; served by {@code idx_support_tickets_created} (V53). */
    Page<SupportTicket> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /** Awaiting-reply view, served by the partial {@code idx_support_tickets_awaiting_reply} (V53). Derived, not a
     * nullable-flag {@code @Query}: Postgres cannot use a partial index behind {@code :flag is null or ...}. */
    Page<SupportTicket> findByStaffUnreadTrueOrderByCreatedAtDesc(Pageable pageable);

    /** Complement of the awaiting-reply view, so {@code ?awaitingReply=false} is honoured. Needs no index: it is
     * most of the table, so walking {@code idx_support_tickets_created} fills a page quickly. */
    Page<SupportTicket> findByStaffUnreadFalseOrderByCreatedAtDesc(Pageable pageable);

    // One grouped COUNT for the queue's three tab totals; the partial index serves the true side.
    @Query("select t.staffUnread, count(t) from SupportTicket t group by t.staffUnread")
    List<Object[]> countByStaffUnread();
}
