package com.punenest.api.leads.notes;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * One owner's private annotation on one lead — a note, a follow-up date, or both. Maps
 * {@code lead_notes} (V119).
 *
 * <p><strong>The only entity in {@code leads} whose target is an opaque string rather than an id.</strong>
 * {@code leadKey} is minted by the client ({@code 'number:<uuid>'}, {@code 'photo:<uuid>'},
 * {@code 'flatmate:<uuid>'}, {@code 'documents:<buyerMobile>|<propertyId>'}) and is never parsed
 * here. V119 has the full reasoning; the short version is that the Requests inbox unions four
 * unrelated tables and one of its keys groups several rows rather than naming one, so there is no
 * column this could point at.
 *
 * <p><strong>The document key carries a buyer's mobile number, so treat the column as personal
 * data.</strong> {@code EnquiriesPanel.groupDocReqs} builds that key from {@code buyerMobile}, and
 * in the one situation it appears the number is unmasked — the buyer granted document access, so
 * the owner already has it to dial. Nothing here is worsened by storing it, since only the owner who
 * wrote the note can ever read it back. But it does mean this column is not the anonymous handle the
 * other three shapes make it look, so it must not be logged, indexed for search, or handed to a
 * third party on the assumption that it is opaque.
 *
 * <p><strong>Owner-private.</strong> {@code ownerId} always comes from the JWT. Nothing reads a note
 * by id alone, and no buyer-facing response carries one.
 *
 * <p><strong>Never blank.</strong> A row with neither field is meaningless, so the V119 CHECK
 * forbids it and {@link LeadNoteService} deletes instead of writing one. That is what lets the
 * inbox answer "does this lead have a note" by existence.
 */
@Entity
@Table(name = "lead_notes")
@Getter
public class LeadNote extends AuditedEntity {

    @Column(name = "owner_id", nullable = false, updatable = false)
    private UUID ownerId;

    @Column(name = "lead_key", nullable = false, updatable = false)
    private String leadKey;

    @Column(name = "note")
    private String note;

    @Column(name = "follow_up_at")
    private Instant followUpAt;

    protected LeadNote() {
        // JPA
    }

    public LeadNote(UUID ownerId, String leadKey) {
        this.ownerId = ownerId;
        this.leadKey = leadKey;
    }

    /**
     * Replace both fields wholesale.
     *
     * <p>A replace rather than a merge, deliberately. The owner edits the note and the follow-up
     * date through two separate controls, so the <em>UI</em> naturally produces partial patches — but
     * a partial patch over JSON cannot tell "field omitted" from "field cleared to null", and every
     * workaround for that (a nullable wrapper type, a sentinel, a {@code fields} list) buys
     * ambiguity back at a higher price. The merge belongs where the current value already is, which
     * is the panel holding the loaded annotations; by the time it reaches here the caller knows what
     * the whole annotation should be.
     */
    public void replace(String note, Instant followUpAt) {
        this.note = note;
        this.followUpAt = followUpAt;
    }
}
