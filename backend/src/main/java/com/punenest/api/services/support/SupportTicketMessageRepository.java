package com.punenest.api.services.support;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Thread reads. Messages are immutable once written. */
public interface SupportTicketMessageRepository extends JpaRepository<SupportTicketMessage, UUID> {

    List<SupportTicketMessage> findByTicketIdOrderByCreatedAtAsc(UUID ticketId);

    /**
     * The list read: one query for every ticket in the response rather than one per ticket. The
     * contract's {@code SupportTicket} carries its messages inline on the list as well as the
     * detail, so without this the inbox is an N+1 by construction.
     */
    List<SupportTicketMessage> findByTicketIdInOrderByCreatedAtAsc(Collection<UUID> ticketIds);
}
