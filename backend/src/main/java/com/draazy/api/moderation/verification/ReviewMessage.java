package com.draazy.api.moderation.verification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Id;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UuidGenerator;

/**
 * One message in the owner&lt;-&gt;ops clarification thread (table {@code review_messages}). The
 * sender's side is derived, not stored, and the row is immutable except for {@code read_at}.
 */
@Entity
@Table(name = "review_messages")
@Getter
public class ReviewMessage {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * Owning-side back-reference. A getter here would complete the PropertyReview -> messages ->
     * review cycle. Nothing needs to navigate upwards.
     */
    @ManyToOne(optional = false)
    @JoinColumn(name = "review_id", nullable = false, updatable = false)
    @Getter(AccessLevel.NONE)
    private PropertyReview review;

    @Column(name = "sender_id", updatable = false)
    private UUID senderId;

    @Column(name = "body", nullable = false, updatable = false)
    private String body;

    /**
     * Staff-only: present in the case file ops reads, absent from the owner's copy, because the
     * duplicate probe's finding names another listing. Immutable, like the body.
     */
    @Column(name = "internal", nullable = false, updatable = false)
    private boolean internal;

    @Column(name = "clarification_requested", nullable = false, updatable = false)
    private boolean clarificationRequested;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** Null until the other participant reads it. See V19 for why this is a timestamp, not a flag. */
    @Column(name = "read_at")
    private Instant readAt;

    protected ReviewMessage() {
        // JPA
    }

    ReviewMessage(PropertyReview review, UUID senderId, String body, boolean internal,
            boolean clarificationRequested) {
        this.review = review;
        this.senderId = senderId;
        this.body = body;
        this.internal = internal;
        this.clarificationRequested = clarificationRequested;
    }

    public void markRead() {
        if (readAt == null) {
            readAt = Instant.now();
        }
    }
}
