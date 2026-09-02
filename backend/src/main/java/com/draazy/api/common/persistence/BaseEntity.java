package com.draazy.api.common.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UuidGenerator;

/**
 * Root of every entity. Carries the two columns present on all business tables: an opaque UUID
 * {@code id} (reconciliation #1) and {@code created_at}.
 *
 * <p>Why in-app UUID + timestamp generation rather than leaning on the DB defaults: entities boot
 * under {@code ddl-auto=validate}, so Hibernate must supply the values itself — the schema's
 * {@code DEFAULT gen_random_uuid()} / {@code DEFAULT now()} only cover raw-SQL inserts.
 */
@MappedSuperclass
public abstract class BaseEntity {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public UUID getId() {
        return id;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
