package com.draazy.api.moderation.verification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

/**
 * One line of the verification checklist (table {@code property_review_checklist}, V5).
 *
 * <p>Rows rather than a jsonb blob, matching V5. The checklist is queried ("how many listings are
 * stuck on ownership proof?") and a blob would make that a scan-and-parse.
 *
 * <p>Does not extend {@code AuditedEntity}: the V5 table has no timestamp columns, and the item's
 * lifetime is its parent review's.
 */
@Entity
@Table(name = "property_review_checklist")
@Getter
public class ReviewChecklistItem {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * Owning-side back-reference. A getter here would complete the PropertyReview -> checklist ->
     * review cycle and make the graph serialisable into infinite recursion. Nothing needs to
     * navigate upwards.
     */
    @ManyToOne(optional = false)
    @JoinColumn(name = "review_id", nullable = false, updatable = false)
    @Getter(AccessLevel.NONE)
    private PropertyReview review;

    @Column(name = "item", nullable = false, updatable = false)
    private String item;

    @Column(name = "pass", nullable = false)
    @Setter
    private boolean pass = false;

    protected ReviewChecklistItem() {
        // JPA
    }

    ReviewChecklistItem(PropertyReview review, String item) {
        this.review = review;
        this.item = item;
    }
}
