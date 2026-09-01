package com.punenest.api.engagement.society;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * One answer to a {@link SocietyQuestion} (V102 {@code society_answers}).
 *
 * <p>Its own table rather than a nullable {@code parent_id} on {@link SocietyQuestion}: an answer
 * cannot exist without a question, and a self-reference would let one. The foreign key is
 * {@code ON DELETE CASCADE} because half a thread is worse than none.
 */
@Entity
@Table(name = "society_answers")
@Getter
public class SocietyAnswer extends AuditedEntity {

    @Column(name = "question_id", nullable = false, updatable = false)
    private UUID questionId;

    /** When a moderator took this off the public site, or null. The row survives a removal. */
    @Column(name = "removed_at")
    private java.time.Instant removedAt;

    /** The moderator who removed it. Paired with {@code removedAt} by a CHECK constraint. */
    @Column(name = "removed_by")
    private UUID removedBy;

    @Column(name = "author_id", nullable = false, updatable = false)
    private UUID authorId;

    @Column(name = "body", nullable = false)
    private String body;

    protected SocietyAnswer() {
    }

    SocietyAnswer(UUID questionId, UUID authorId, String body) {
        this.questionId = questionId;
        this.authorId = authorId;
        this.body = body;
    }
}
