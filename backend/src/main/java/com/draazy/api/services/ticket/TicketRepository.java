package com.draazy.api.services.ticket;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Ticket board reads; the team is resolved by the service, never taken from the caller's raw {@code ?team=}. */
public interface TicketRepository extends JpaRepository<Ticket, UUID> {

    @Query("""
            select t from Ticket t
            where (:allTeams = true or t.team in :teams)
              and (:status is null or t.status = :status)
            order by t.createdAt desc
            """)
    Page<Ticket> findForBoard(@Param("allTeams") boolean allTeams,
            @Param("teams") List<String> teams,
            @Param("status") String status,
            Pageable pageable);

    @Query("""
            select count(t) from Ticket t
            where (:allTeams = true or t.team in :teams)
              and t.status = :status
            """)
    long countForBoard(@Param("allTeams") boolean allTeams,
            @Param("teams") List<String> teams,
            @Param("status") String status);

    /** Counts every ticket for the number, not just waitlist ones, so alternating services can't dodge the cap. */
    long countByMobileAndCreatedAtAfter(String mobile, Instant since);

    /** Idempotency check for {@code POST /service-waitlist}; the subject is fixed by {@link ServiceWaitlists} so a
     * client typo can't duplicate a row, and only open statuses count so a closed lead can be raised again. */
    boolean existsByMobileAndSubjectAndStatusIn(String mobile, String subject,
            Collection<String> statuses);
}
