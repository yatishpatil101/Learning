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
     */
    @Query("""
            select a from AuditLog a
            where (:actor is null or a.actor = :actor)
              and (:entity is null or a.entity = :entity)
              and (:from is null or a.at >= :from)
              and (:to is null or a.at <= :to)
            order by a.at desc, a.id desc
            """)
    Page<AuditLog> search(@Param("actor") String actor,
            @Param("entity") String entity,
            @Param("from") Instant from,
            @Param("to") Instant to,
            Pageable pageable);
}
