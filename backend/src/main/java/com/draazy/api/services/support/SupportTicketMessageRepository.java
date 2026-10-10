package com.draazy.api.services.support;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Thread reads. Messages are immutable once written. */
public interface SupportTicketMessageRepository extends JpaRepository<SupportTicketMessage, UUID> {

    List<SupportTicketMessage> findByTicketIdOrderByCreatedAtAsc(UUID ticketId);

    /** One query for every ticket in the response: the list carries messages inline,
     * so per-ticket reads would make the inbox an N+1. */
    List<SupportTicketMessage> findByTicketIdInOrderByCreatedAtAsc(Collection<UUID> ticketIds);

    /** The list preview: each ticket's newest message(s), so no thread is read. A timestamp tie returns both. */
    @Query("""
            select m from SupportTicketMessage m
             where m.ticketId in :ticketIds
               and m.createdAt = (select max(x.createdAt) from SupportTicketMessage x
                                   where x.ticketId = m.ticketId)
            """)
    List<SupportTicketMessage> findLatestByTicketIdIn(@Param("ticketIds") Collection<UUID> ticketIds);
}
