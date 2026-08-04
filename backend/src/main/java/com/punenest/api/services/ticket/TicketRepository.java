package com.punenest.api.services.ticket;

import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Ticket board reads.
 *
 * <p>The single query takes a team that the <em>service</em> resolves — never the caller's raw
 * {@code ?team=}. A staff member's team is pinned to their own; only an admin's filter reaches this
 * parameter. See {@link TicketService#list} for why a null team means "no tickets" on the staff path
 * and "every ticket" on the admin path, and why those two cases are decided before the query rather
 * than inside it.
 */
public interface TicketRepository extends JpaRepository<Ticket, UUID> {

    @Query("""
            select t from Ticket t
            where (:team is null or t.team = :team)
              and (:status is null or t.status = :status)
            order by t.createdAt desc
            """)
    Page<Ticket> findForBoard(@Param("team") String team,
            @Param("status") String status,
            Pageable pageable);
}
