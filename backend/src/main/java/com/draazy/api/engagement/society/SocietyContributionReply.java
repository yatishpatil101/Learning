package com.draazy.api.engagement.society;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * One reply in the thread under a community contribution (V103
 * {@code society_contribution_replies}).
 *
 * <p>A separate table rather than a nullable {@code parent_id} on the contribution itself, for the
 * same reason answers are separate from questions: a reply cannot exist without something to reply
 * to, and a self-referencing column would let one. It also keeps a reply from needing the columns —
 * kind, photo URL, referral name — that only make sense on a post.
 *
 * <p>Cascades on delete. Replies to a removed tip are answers to a question the reader cannot see.
 */
@Entity
@Table(name = "society_contribution_replies")
@Getter
public class SocietyContributionReply extends AuditedEntity {

    @Column(name = "contribution_id", nullable = false, updatable = false)
    private UUID contributionId;

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

    protected SocietyContributionReply() {
    }

    SocietyContributionReply(UUID contributionId, UUID authorId, String body) {
        this.contributionId = contributionId;
        this.authorId = authorId;
        this.body = body;
    }
}
