package com.draazy.api.common.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import java.time.Instant;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * A {@link BaseEntity} that also carries {@code updated_at}. The column is maintained both by
 * Hibernate ({@link UpdateTimestamp}) and by the DB {@code set_updated_at} trigger (for raw SQL),
 * so it stays correct regardless of the write path.
 */
@MappedSuperclass
public abstract class AuditedEntity extends BaseEntity {

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
