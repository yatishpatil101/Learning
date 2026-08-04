package com.punenest.api.common.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

/**
 * An append-only audit trail row (schema: AuditEntry). Written server-side on every maker-checker /
 * money / privileged mutation. {@code actor}/{@code checker} are resolved server-side, never
 * client-supplied. Immutable — no {@code updated_at}; its {@code at} column is the creation stamp,
 * so this entity intentionally does not extend {@code BaseEntity}. Maps {@code audit_log} (V1).
 */
@Entity
@Table(name = "audit_log")
@Getter
public class AuditLog {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "actor", updatable = false)
    private String actor;

    @Column(name = "actor_role", updatable = false)
    private String actorRole;

    @Column(name = "action", nullable = false, updatable = false)
    private String action;

    @Column(name = "entity", updatable = false)
    private String entity;

    @Column(name = "entity_id", updatable = false)
    private String entityId;

    @Column(name = "checker", updatable = false)
    private String checker;

    /** Free-form JSON context (e.g. before/after diff). Stored as jsonb. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", nullable = false, updatable = false)
    private String metadata = "{}";

    @CreationTimestamp
    @Column(name = "at", nullable = false, updatable = false)
    private Instant at;

    protected AuditLog() {
        // JPA
    }

    public AuditLog(String actor, String actorRole, String action, String entity, String entityId,
            String checker, String metadata) {
        this.actor = actor;
        this.actorRole = actorRole;
        this.action = action;
        this.entity = entity;
        this.entityId = entityId;
        this.checker = checker;
        this.metadata = metadata == null ? "{}" : metadata;
    }

}
