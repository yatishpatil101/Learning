package com.draazy.api.services.ticket;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Note reads. Append-only, so there is no update or delete path. */
public interface TicketNoteRepository extends JpaRepository<TicketNote, UUID> {

    List<TicketNote> findByTicketIdOrderByAtAsc(UUID ticketId);

    /** The board read: every ticket's notes in one query rather than one per row. */
    List<TicketNote> findByTicketIdInOrderByAtAsc(Collection<UUID> ticketIds);
}
