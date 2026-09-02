package com.draazy.api.leads.contact;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A buyer's request to see a listing owner's contact details — the row behind the contact gate.
 * Maps {@code contact_requests} (V4).
 *
 * <p><strong>Ids, not associations.</strong> {@code propertyId} and {@code requesterId} are plain
 * UUID columns rather than {@code @ManyToOne} graphs. Two reasons: the owner inbox reads thousands of
 * rows and an eager association is an N+1 waiting to happen, and — more importantly — this entity
 * lives in the {@code leads} context while the targets live in {@code catalog} and {@code identity},
 * so an object reference would hard-wire a cross-context join that
 * {@code package-structure.md} §5 asks us to keep at the id level.
 *
 * <p><strong>No soft-delete triplet</strong>, unlike most business tables: V4 gives
 * {@code contact_requests} no {@code archived}/{@code archived_at}/{@code archive_reason} columns, so
 * this extends {@link AuditedEntity} rather than {@code SoftDeleteEntity}. Nothing here is ever hard
 * deleted either — a request is answered ({@code approved}/{@code declined}), not removed, because
 * the gate's audit trail is the record of who was granted a number and when.
 *
 * <p><strong>Masking is never stored</strong> (V4 header): the raw owner mobile lives on
 * {@code users} and is masked or revealed at the API edge per {@link ContactStatuses#revealsContact}.
 */
@Entity
@Table(name = "contact_requests")
@Getter
public class ContactRequest extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** The asking user. Always taken from the JWT — never from the request body. */
    @Column(name = "requester_id", nullable = false, updatable = false)
    private UUID requesterId;

    /** One of {@link ContactRequestStatuses}; the V4 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    @Setter
    private String status = ContactRequestStatuses.PENDING;

    /** Optional free-text note from the requester, shown to the owner in their inbox. */
    @Column(name = "message")
    @Setter
    private String message;

    protected ContactRequest() {
        // JPA
    }

    public ContactRequest(UUID propertyId, UUID requesterId, String message) {
        this.propertyId = propertyId;
        this.requesterId = requesterId;
        this.message = message;
    }

}
