package com.punenest.api.engagement.society;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * A question asked on a society hub (V102 {@code society_questions}).
 *
 * <p><strong>Why anyone signed in may ask.</strong> The person with the most to ask about a society
 * is the one who does not live there yet — is the water supply reliable, is the parking really one
 * per flat, does the committee actually meet. Gating questions on residency would leave the hub
 * answering only the questions its residents already know the answers to.
 *
 * <p>Answering is equally open, and the reader is protected by the badge rather than by the gate:
 * {@link SocietyQuestionResponse} marks an author who is a verified resident of this society, so an
 * answer from B/704 is visibly different from an answer from a stranger without silencing the
 * stranger, who may be a neighbour who has not got round to verifying.
 *
 * <p><strong>The badge is not a column here.</strong> It is read from {@code society_residents} at
 * render time. A stored copy would keep asserting "verified resident" after the committee rejected
 * the person — the one thing a trust badge must never do.
 */
@Entity
@Table(name = "society_questions")
@Getter
public class SocietyQuestion extends AuditedEntity {

    @Column(name = "society_id", nullable = false, updatable = false)
    private UUID societyId;

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

    protected SocietyQuestion() {
    }

    SocietyQuestion(UUID societyId, UUID authorId, String body) {
        this.societyId = societyId;
        this.authorId = authorId;
        this.body = body;
    }
}
