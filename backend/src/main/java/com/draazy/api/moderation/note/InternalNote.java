package com.draazy.api.moderation.note;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "internal_notes")
@Getter
public class InternalNote extends BaseEntity {

    @Column(name = "entity_type", nullable = false, updatable = false)
    private String entityType;

    @Column(name = "entity_id", nullable = false, updatable = false)
    private String entityId;

    /** Server-resolved from the JWT principal. Never read from the request body. */
    @Column(name = "author_id", nullable = false, updatable = false)
    private UUID authorId;

    @Column(name = "action", updatable = false)
    private String action;

    @Column(name = "text", nullable = false)
    private String text;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected InternalNote() {

    }

    public InternalNote(String entityType, String entityId, UUID authorId, String action,
            String text) {
        this.entityType = entityType;
        this.entityId = entityId;
        this.authorId = authorId;
        this.action = action;
        this.text = text;
    }
}
