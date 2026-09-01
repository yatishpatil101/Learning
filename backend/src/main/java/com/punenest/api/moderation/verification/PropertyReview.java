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
     * When anyone last said anything in this thread, and what the ops queue sorts on (V81, V82).
     *
     * <p>Never null: a case nobody has spoken in carries the moment it was opened, so the sort key
     * means one thing on every row rather than needing a coalesce that no index can serve.
     * Maintained in {@link #add}; see the note there for why {@code updatedAt} could not do this job.
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
        return add(senderId, body, false);
    }

    /**
     * A note only staff can read (V80).
     *
     * <p>Takes no sender because there is nobody to attribute it to: these are written by the
     * platform itself, not by a moderator, and inventing a system user to sign them would put a
     * fictional participant in a thread whose whole value is being an accurate record of who said
     * what.
     */
    public ReviewMessage addInternalNote(String body) {
        return add(null, body, true);
    }

    private ReviewMessage add(UUID senderId, String body, boolean internal) {
        ReviewMessage message = new ReviewMessage(this, senderId, body, internal);
        messages.add(message);
        /* Touch the parent, or the ops queue never learns anything was said. review_messages owns
         * the association, so adding to this list inserts a child and leaves property_reviews
         * clean: @UpdateTimestamp does not fire, the set_updated_at trigger does not fire, and a
         * queue sorted on updated_at leaves the case exactly where it was. An owner replying to a
         * moderator, and a duplicate flag landing on a case file that already existed, both sank.
         *
         * A column rather than a manual updated_at poke because this one names what the desk
         * triages by. It sorts identically to updated_at today -- writing it dirties the row, so
         * updated_at follows, and decide() is the only other writer that touches the parent and it
         * posts a message too -- but it is the write that makes the row dirty in the first place,
         * which was the whole bug, and it stays correct the first time something touches a case
         * without speaking in it. Never null: a case nobody has spoken in carries the moment it was
         * opened (V82), so the sort key means one thing on every row. */
        this.lastMessageAt = Instant.now();
        return message;
    }

    public void decide(String status, String reviewer, String note) {
        this.status = status;
        this.reviewer = reviewer;
        this.notes = note;
        this.decidedAt = Instant.now();
    }

}
