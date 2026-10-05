package com.draazy.api.moderation.verification;

import com.draazy.api.common.persistence.AuditedEntity;
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

@Entity
@Table(name = "property_reviews")
@Getter
public class PropertyReview extends AuditedEntity {

    @Column(name = "property_id", nullable = false, unique = true, updatable = false)
    private UUID propertyId;

    @Column(name = "status", nullable = false)
    @Setter
    private String status = "pending";

    @Column(name = "reviewer")
    private String reviewer;

    @Column(name = "notes")
    private String notes;

    @Column(name = "reason_code")
    private String reasonCode;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "last_message_at", nullable = false)
    private Instant lastMessageAt = Instant.now();

    @OneToMany(mappedBy = "review", cascade = CascadeType.ALL, orphanRemoval = true,
            fetch = FetchType.LAZY)
    private List<ReviewChecklistItem> checklist = new ArrayList<>();

    @OneToMany(mappedBy = "review", cascade = CascadeType.ALL, orphanRemoval = true,
            fetch = FetchType.LAZY)
    @OrderBy("createdAt asc")
    private List<ReviewMessage> messages = new ArrayList<>();

    protected PropertyReview() {

    }

    public PropertyReview(UUID propertyId) {
        this.propertyId = propertyId;
    }

    public void addChecklistItem(String item) {
        checklist.add(new ReviewChecklistItem(this, item));
    }

    public ReviewMessage addMessage(UUID senderId, String body) {
        return addMessage(senderId, body, false);
    }

    public ReviewMessage addMessage(UUID senderId, String body, boolean clarificationRequested) {
        return add(senderId, body, false, clarificationRequested);
    }

    // No sender: a system user would add a fictional participant to the thread.
    public ReviewMessage addInternalNote(String body) {
        return add(null, body, true, false);
    }

    private ReviewMessage add(UUID senderId, String body, boolean internal, boolean clarificationRequested) {
        ReviewMessage message = new ReviewMessage(this, senderId, body, internal, clarificationRequested);
        messages.add(message);

        this.lastMessageAt = Instant.now();
        return message;
    }

    public void decide(String status, String reviewer, String note, String reasonCode) {
        this.status = status;
        this.reviewer = reviewer;
        this.notes = note;
        this.decidedAt = Instant.now();
        this.reasonCode = reasonCode;
    }

    public void begin(String reviewer) {
        if (this.reviewer == null) {
            this.reviewer = reviewer;
        }
    }

    public void reopen() {
        this.status = PropertyReviewStatuses.STORED_PENDING;
        this.decidedAt = null;
        this.reasonCode = null;
        this.checklist.forEach(ReviewChecklistItem::reset);
    }

}
