package com.punenest.api.moderation.verification;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * The moderation record for one listing under review (schema {@code PropertyReview}, table
 * {@code property_reviews} from V5).
 *
 * <p>Deliberately <em>not</em> a duplicate of {@code properties.status}. The two answer different
 * questions and both are needed: {@code properties.status} is the listing's public visibility, while
 * this row is the case file behind the decision — who reviewed it, against which checklist, what was
 * said, and when it was decided. Collapsing them would mean approving a listing erased the record of
 * why it was approved.
 *
 * <p>{@code property_id} is {@code UNIQUE}, so a listing has at most one review case at a time; a
 * re-submission reopens the same row rather than starting a parallel history.
 */
@Entity
@Table(name = "property_reviews")
@Getter
public class PropertyReview extends AuditedEntity {

    @Column(name = "property_id", nullable = false, unique = true, updatable = false)
    private UUID propertyId;

    @Column(name = "status", nullable = false)
    @Setter
    private String status = "pending";

    /** Display handle of the staff member who took the case. Free text, per the V5 schema. */
    @Column(name = "reviewer")
    private String reviewer;

    @Column(name = "notes")
    private String notes;

    @Column(name = "decided_at")
    private Instant decidedAt;

    /**
     * Cascaded because a checklist item has no meaning outside its review — it is a component of the
     * case file, not an entity anything else references.
     */
    @OneToMany(mappedBy = "review", cascade = CascadeType.ALL, orphanRemoval = true,
            fetch = FetchType.LAZY)
    private List<ReviewChecklistItem> checklist = new ArrayList<>();

    @OneToMany(mappedBy = "review", cascade = CascadeType.ALL, orphanRemoval = true,
            fetch = FetchType.LAZY)
    @OrderBy("createdAt asc")
    private List<ReviewMessage> messages = new ArrayList<>();

    protected PropertyReview() {
        // JPA
    }

    public PropertyReview(UUID propertyId) {
        this.propertyId = propertyId;
    }

    /** Add a checklist item, keeping both sides of the association consistent. */
    public void addChecklistItem(String item) {
        checklist.add(new ReviewChecklistItem(this, item));
    }

    public ReviewMessage addMessage(UUID senderId, String body) {
        ReviewMessage message = new ReviewMessage(this, senderId, body);
        messages.add(message);
        return message;
    }

    public void decide(String status, String reviewer, String note) {
        this.status = status;
        this.reviewer = reviewer;
        this.notes = note;
        this.decidedAt = Instant.now();
    }

}
