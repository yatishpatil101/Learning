package com.punenest.api.common.audit;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuditLogRepository extends JpaRepository<AuditLog, UUID> {

    /**
     * Backs {@code GET /admin/audit-log}. All four filters are optional and combine with AND.
     *
     * <p>Ordered newest-first in the query rather than by an incoming {@code sort} parameter: the
     * log is read as a timeline, and letting a caller re-sort it by, say, {@code actor} would make
     * "show me what happened around 14:00" impossible to page through consistently. V18 indexes
     * {@code (actor, at DESC)} and {@code (entity, at DESC)} to match.
     *
     * <p>{@code id} is the tiebreaker, and on this table it earns its keep. A burst of writes — one
     * request that moderates a listing and archives its owner, say — can land several rows on the
     * same timestamp, and {@code at} alone leaves their relative order up to the plan. Paging a
     * non-deterministic sort silently drops and repeats rows, which on an ordinary list is a
     * cosmetic glitch and on the audit log is a missing entry in the one record consulted precisely
     * when someone suspects something.
     *
     * <p><strong>Why the null checks are cast and the comparisons are not.</strong> A bare
     * {@code :from is null} renders as {@code $5 is null}, which gives PostgreSQL no way to infer
     * what {@code $5} is: that comparison is true or false for a parameter of <em>any</em> type, so
     * nothing in the position constrains it. The server refuses the whole statement — {@code could
     * not determine data type of parameter $5} — so the unfiltered call, the one the admin console
     * makes when it opens, answered 500. The cast names the type in the position that lacks one,
     * matching {@code FlatmateRoomRepository} and {@code TransactionRepository}, which hit the same
     * wall. Not fixed by requiring a filter: "no filters" is the default view of a timeline.
     *
     * <p>The second occurrence is deliberately left bare, and casting it too is not a harmless
     * belt-and-braces — it is the bug back in a new costume. Hibernate types a parameter from how
     * it is <em>used</em>, and a cast is not a use: a parameter that appears only inside casts has
     * no inferred type at all and is bound as {@code bytea}, which PostgreSQL then refuses with
     * {@code cannot cast type bytea to timestamp with time zone}. {@code a.at >= :from} is what
     * tells Hibernate this is an {@code Instant}; the cast merely repeats that fact to the server
     * in the one place the SQL cannot work it out. Both halves are needed and neither is optional.
     */
    @Query("""
            select a from AuditLog a
            where (cast(:actor as string) is null or a.actor = :actor)
              and (cast(:entity as string) is null or a.entity = :entity)
              and (cast(:from as Instant) is null or a.at >= :from)
              and (cast(:to as Instant) is null or a.at <= :to)
            order by a.at desc, a.id desc
            """)
    Page<AuditLog> search(@Param("actor") String actor,
            @Param("entity") String entity,
            @Param("from") Instant from,
            @Param("to") Instant to,
            Pageable pageable);
}
