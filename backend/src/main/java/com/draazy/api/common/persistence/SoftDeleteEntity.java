package com.draazy.api.common.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import java.time.Instant;

/**
 * A {@link AuditedEntity} carrying the platform-wide soft-delete triplet
 * ({@code archived}/{@code archived_at}/{@code archive_reason}). Business entities are never
 * hard-deleted; public queries filter {@code archived = false} and admin views opt in with
 * {@code ?archived=true}.
 */
@MappedSuperclass
public abstract class SoftDeleteEntity extends AuditedEntity {

    @Column(name = "archived", nullable = false)
    private boolean archived = false;

    @Column(name = "archived_at")
    private Instant archivedAt;

    @Column(name = "archive_reason")
    private String archiveReason;

    public boolean isArchived() {
        return archived;
    }

    public Instant getArchivedAt() {
        return archivedAt;
    }

    public String getArchiveReason() {
        return archiveReason;
    }

    /** Soft-delete this row with an audit reason. */
    public void archive(String reason) {
        this.archived = true;
        this.archivedAt = Instant.now();
        this.archiveReason = reason;
    }

    /** Reverse a soft-delete. */
    public void restore() {
        this.archived = false;
        this.archivedAt = null;
        this.archiveReason = null;
    }
}
