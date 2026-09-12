package com.draazy.api.engagement.society;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import lombok.Getter;

/**
 * One person finding one contribution helpful (V103 {@code society_contribution_helpful}).
 *
 * <p>A row rather than a counter, and the pair is the primary key. That is the difference between
 * "one vote per person" being a rule the code tries to keep and a fact the database cannot break:
 * a double tap, a retried request on a flaky connection, or two tabs open at once all collapse
 * into the same row. Un-voting is a delete, and the count on the card is {@code count(*)}, so it
 * has nothing to drift from.
 *
 * <p>Deliberately not an {@link com.draazy.api.common.persistence.AuditedEntity}: a surrogate id
 * on a pure join row buys nothing and would quietly permit the duplicate this table exists to
 * prevent. {@code createdAt} is kept because "when did this become popular" is a question ops will
 * eventually ask; there is no {@code updatedAt} because a vote is never edited, only withdrawn.
 */
@Entity
@Table(name = "society_contribution_helpful")
@Getter
public class SocietyContributionHelpful {

    @EmbeddedId
    private Id id;

    @Column(name = "created_at", nullable = false, updatable = false, insertable = false)
    private Instant createdAt;

    protected SocietyContributionHelpful() {
    }

    SocietyContributionHelpful(UUID contributionId, UUID userId) {
        this.id = new Id(contributionId, userId);
    }

    /** The composite key: which post, and who. */
    @Embeddable
    @Getter
    public static class Id implements Serializable {

        @Column(name = "contribution_id", nullable = false, updatable = false)
        private UUID contributionId;

        @Column(name = "user_id", nullable = false, updatable = false)
        private UUID userId;

        protected Id() {
        }

        Id(UUID contributionId, UUID userId) {
            this.contributionId = contributionId;
            this.userId = userId;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof Id that)) {
                return false;
            }
            return Objects.equals(contributionId, that.contributionId)
                    && Objects.equals(userId, that.userId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(contributionId, userId);
        }
    }
}
