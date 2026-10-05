package com.draazy.api.moderation.verification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import org.hibernate.annotations.UuidGenerator;

// One line of the verification checklist (table property_review_checklist, ). Rows rather than a jsonb blob, matching.
@Entity
@Table(name = "property_review_checklist")
@Getter
public class ReviewChecklistItem {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "review_id", nullable = false, updatable = false)
    @Getter(AccessLevel.NONE)
    private PropertyReview review;

    @Column(name = "item", nullable = false, updatable = false)
    private String item;

    @Column(name = "pass", nullable = false)
    private boolean pass = false;

    @Column(name = "checked_by")
    private UUID checkedBy;

    @Column(name = "checked_at")
    private Instant checkedAt;

    protected ReviewChecklistItem() {

    }

    ReviewChecklistItem(PropertyReview review, String item) {
        this.review = review;
        this.item = item;
    }

    public void mark(boolean pass, UUID actorId) {
        this.pass = pass;
        this.checkedBy = actorId;
        this.checkedAt = Instant.now();
    }

    public void reset() {
        this.pass = false;
        this.checkedBy = null;
        this.checkedAt = null;
    }
}
