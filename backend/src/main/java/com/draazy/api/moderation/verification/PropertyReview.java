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

/**
 * The moderation record for one listing under review (table {@code property_reviews}). Not a
 * duplicate of {@code properties.status}: that is visibility, this is the case file behind it.
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
     * When anyone last said anything in this thread, and what the ops queue sorts on. Never null —
     * a case nobody has spoken in carries the moment it was opened, so no index-defeating coalesce.
     */
    @Column(name = "last_message_at", nullable = false)
    private Instant lastMessageAt = Instant.now();

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
        return addMessage(senderId, body, false);
    }

    public ReviewMessage addMessage(UUID senderId, String body, boolean clarificationRequested) {
        return add(senderId, body, false, clarificationRequested);
    }

    /**
     * A note only staff can read. Takes no sender: the platform writes these, and inventing a system
     * user would put a fictional participant in a thread whose value is being an accurate record.
     */
    public ReviewMessage addInternalNote(String body) {
        return add(null, body, true, false);
    }

    private ReviewMessage add(UUID senderId, String body, boolean internal, boolean clarificationRequested) {
        ReviewMessage message = new ReviewMessage(this, senderId, body, internal, clarificationRequested);
        messages.add(message);
        /* Touch the parent, or the ops queue never learns anything was said: review_messages owns
         * the association, so adding a child leaves property_reviews clean and the case does not move. */
        this.lastMessageAt = Instant.now();
        return message;
    }

    public void decide(String status, String reviewer, String note) {
        this.status = status;
        this.reviewer = reviewer;
        this.notes = note;
        this.decidedAt = Instant.now();
    }

    public void begin(String reviewer) {
        if (this.reviewer == null) {
            this.reviewer = reviewer;
        }
    }

    /**
     * Put a decided case back on the desk. Reviewer and notes stay, being the record under answer; the
     * checklist does not, since its ticks describe documents the resubmission has just replaced.
     */
    public void reopen() {
        this.status = "pending";
        this.decidedAt = null;
        this.checklist.forEach(line -> line.setPass(false));
    }

}
