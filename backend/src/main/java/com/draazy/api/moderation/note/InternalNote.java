package com.draazy.api.moderation.note;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * One internal note a member of staff wrote about a listing, a person, a review or a report. Maps
 * the {@code internal_notes} table (V90).
 *
 * <p>The target is an {@code (entity_type, entity_id)} pair rather than four nullable foreign keys,
 * following {@code Report} and {@code Review}: the four kinds live in four tables and one of them
 * ({@code report}) is itself polymorphic. {@code entity_id} is {@code text} and is <em>not</em>
 * resolved against the target table. A note about a listing that is archived an hour later is still
 * the note that explains why, and losing it because the row it points at moved is the failure mode
 * this shape avoids.
 *
 * <h2>Mutable, and that is a decision (D29)</h2>
 *
 * <p>This diverges deliberately from the two note-ish things that came before it. {@code TicketNote}
 * is append-only with no update path, and {@code AuditLog} is immutable on every column, both for
 * good reasons: an audit row that can be edited after the fact is worth nothing in a dispute.
 *
 * <p>An internal note is not an audit row. It is <strong>retained customer information</strong> —
 * what ops know about a case — and information that cannot be corrected is worse than information
 * that can, because the wrong version is the one that stays on the screen and gets acted on. The
 * audit trail of <em>who changed what</em> already exists and is a different table; this one holds
 * the current, correctable text. So: {@code updated_at} beside {@code created_at}, and an
 * {@link #edit(String)} that says so.
 *
 * <p>{@code author_id} is the real user id from the principal and is {@code updatable = false}. It
 * is never client-supplied, for the same reason {@code Report.reporterId} is not: an author who can
 * name themselves can also name somebody else. Note the older {@code TicketNote} stores a display
 * name string instead — that shape is not copied. A name is a rendering of an id, not a record of
 * one, and it goes stale the day somebody marries.
 *
 * <p>{@code action} is the maker-checker label the note was filed beside ("Approved", "Archived")
 * and is optional: a note written on its own has no decision attached to it. It is immutable while
 * the text is not, because editing the wording of an observation is a correction and editing which
 * decision it sat beside is a rewrite.
 *
 * <p>No soft-delete and no delete route. A note is a record that somebody on the team knew
 * something; withdrawing it is what an edit is for.
 */
@Entity
@Table(name = "internal_notes")
@Getter
public class InternalNote extends BaseEntity {

    @Column(name = "entity_type", nullable = false, updatable = false)
    private String entityType;

    @Column(name = "entity_id", nullable = false, updatable = false)
    private String entityId;

    /** Server-resolved from the JWT principal. Never read from the request body. */
    @Column(name = "author_id", nullable = false, updatable = false)
    private UUID authorId;

    /** The maker-checker label this note was filed beside, if any. */
    @Column(name = "action", updatable = false)
    private String action;

    @Column(name = "text", nullable = false)
    private String text;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected InternalNote() {
        // JPA
    }

    public InternalNote(String entityType, String entityId, UUID authorId, String action,
            String text) {
        this.entityType = entityType;
        this.entityId = entityId;
        this.authorId = authorId;
        this.action = action;
        this.text = text;
    }

    /**
     * Replace the text. The only mutation this entity allows — see the class note on why it allows
     * one at all.
     */
    public void edit(String next) {
        this.text = next;
    }
}
