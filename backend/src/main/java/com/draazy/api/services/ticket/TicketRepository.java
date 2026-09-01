package com.draazy.api.services.ticket;

import java.time.Instant;
import java.util.Collection;
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

    /**
     * How many tickets this number has raised since {@code since} — the public waitlist's budget
     * (D4). Served by {@code idx_tickets_mobile_created} (V85).
     *
     * <p>Counts <em>every</em> ticket carrying the number, not only waitlist ones. A per-service or
     * per-subject count would be the narrower query and the wrong limit: what the cap protects is
     * the ops board, and a script that alternates between two services to stay under two separate
     * ceilings has still filled it.
     */
    long countByMobileAndCreatedAtAfter(String mobile, Instant since);

    /**
     * Has this number already asked about this exact thing and not been dealt with yet?
     *
     * <p>The idempotency check behind {@code POST /service-waitlist}. Matching on the subject is only
     * safe because the subject is fixed by {@link ServiceWaitlists} rather than sent by the caller —
     * a client-supplied subject would let one person's second signup miss this by a character and
     * land on the board twice.
     *
     * <p>Scoped to the still-open statuses on purpose. A signup the desk has already closed is
     * finished business; somebody asking again months later is a new lead, not a duplicate of a row
     * nobody is looking at any more.
     */
    boolean existsByMobileAndSubjectAndStatusIn(String mobile, String subject,
            Collection<String> statuses);
}
