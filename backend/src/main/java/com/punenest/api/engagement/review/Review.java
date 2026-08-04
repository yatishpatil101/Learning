package com.punenest.api.engagement.review;

import com.punenest.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

/**
 * One review, of a property, locality, society or owner.
 *
 * <p><strong>The target is a {@code (type, id)} pair, not a foreign key</strong>, because the four
 * target kinds do not share a table — or even a key type: a locality's primary key is its slug, a
 * society's is a UUID. {@code target_id} is therefore {@code text}, and the service is responsible
 * for resolving whatever public identifier the caller used into the one canonical key per kind
 * (slice 7 flagged this as undecided; {@link ReviewTargetKey} is where it got decided).
 *
 * <p><strong>{@code context} is written by the server, never by the client.</strong> It is the
 * "Verified resident" / "Visited" badge, derived from the author's tenancy and visit history through
 * {@code common.trust.PropertyExperience}. It is <em>stored</em> rather than recomputed on read, and
 * that is deliberate: a review is a historical statement. Re-deriving it would silently strip a
 * resident's badge the day their lease ended and drop their review out of the UI's "Residents"
 * filter, rewriting what they said after the fact.
 *
 * <p>No {@code archived} column and no delete endpoint in this slice — review moderation belongs to
 * the Moderation tag, which will need to add one.
 */
@Entity
@Table(name = "reviews")
@Getter
public class Review extends BaseEntity {

    @Column(name = "target_type", nullable = false, updatable = false)
    private String targetType;

    @Column(name = "target_id", nullable = false, updatable = false)
    private String targetId;

    /** Nullable in the schema for seeded/legacy rows; every review this API writes has an author. */
    @Column(name = "author_id", updatable = false)
    private UUID authorId;

    @Column(name = "rating", nullable = false)
    private int rating;

    @Column(name = "title")
    @Setter
    private String title;

    @Column(name = "body")
    @Setter
    private String body;

    @Column(name = "status", nullable = false)
    @Setter
    private String status = ReviewStatuses.PUBLISHED;

    /** Server-derived badge: {@code visit} | {@code tenant}, or null for non-property targets. */
    @Column(name = "context")
    @Setter
    private String context;

    /** Sparse per-aspect sub-ratings as a JSON object; {@code "{}"} when none were given. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "categories", nullable = false, columnDefinition = "jsonb")
    @Setter
    private String categories = "{}";

    /** Nullable on purpose — "did not say" is a different answer from "would not recommend". */
    @Column(name = "recommend")
    @Setter
    private Boolean recommend;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Review() {
    }

    public Review(String targetType, String targetId, UUID authorId, int rating) {
        this.targetType = targetType;
        this.targetId = targetId;
        this.authorId = authorId;
        this.rating = rating;
    }

}
