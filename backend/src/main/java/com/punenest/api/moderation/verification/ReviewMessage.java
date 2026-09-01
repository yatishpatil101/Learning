package com.punenest.api.moderation.verification;

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
 * One message in the owner&lt;-&gt;ops clarification thread (table {@code review_messages}, V5, plus
 * the {@code read_at} column added in V19).
 *
 * <p>There is no {@code sender_role} column and there should not be: the sender's side is derived by
 * comparing {@code sender_id} to the listing owner. Storing it would let the two disagree, and the
 * copy that disagreed would be the one the UI rendered — an owner's message displayed as if it came
 * from the platform.
 *
 * <p>Immutable except for {@code read_at}. A moderation thread that can be edited after the fact is
 * not evidence of anything.
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
     * Staff-only: present in the case file ops reads, absent from the owner's copy (V80).
     *
     * <p>Exists because the duplicate probe's finding names <em>another</em> listing. Telling the
     * submitter which one turns their own thread into a lookup for a column the public response
     * withholds. Immutable for the same reason the body is: a note that could be reclassified after
     * the fact is not evidence, and a note that could be reclassified <em>towards</em> the owner is a
     * disclosure with no audit trail.
     */
    @Column(name = "internal", nullable = false, updatable = false)
    private boolean internal;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** Null until the other participant reads it. See V19 for why this is a timestamp, not a flag. */
    @Column(name = "read_at")
    private Instant readAt;

    protected ReviewMessage() {
        // JPA
    }

    ReviewMessage(PropertyReview review, UUID senderId, String body, boolean internal) {
        this.review = review;
        this.senderId = senderId;
        this.body = body;
        this.internal = internal;
    }

    public void markRead() {
        if (readAt == null) {
            readAt = Instant.now();
        }
    }
}
