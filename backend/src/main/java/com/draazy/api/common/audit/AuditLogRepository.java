package com.draazy.api.common.audit;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuditLogRepository extends JpaRepository<AuditLog, UUID> {

    @Query("""
            select a from AuditLog a
            where (cast(:actor as string) is null or a.actor = :actor)
              and (cast(:entity as string) is null or a.entity = :entity)
              and (cast(:entityId as string) is null or a.entityId = :entityId)
              and (cast(:from as Instant) is null or a.at >= :from)
              and (cast(:to as Instant) is null or a.at <= :to)
            order by a.at desc, a.id desc
            """)
    Page<AuditLog> search(@Param("actor") String actor,
            @Param("entity") String entity,
            @Param("entityId") String entityId,
            @Param("from") Instant from,
            @Param("to") Instant to,
            Pageable pageable);

    boolean existsByActorAndActionAndEntityId(String actor, String action, String entityId);
}
