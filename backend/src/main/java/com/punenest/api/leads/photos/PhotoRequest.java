package com.punenest.api.leads.photos;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * One buyer's "I want more photos of this listing" signal. Maps {@code photo_requests} (V117).
 *
 * <p><strong>Ids, not associations</strong>, for the same two reasons as {@link
 * com.punenest.api.leads.contact.ContactRequest}: the owner inbox reads many rows at once and an
 * eager {@code @ManyToOne} is an N+1 waiting to happen, and this entity lives in {@code leads} while
 * its targets live in {@code catalog} and {@code identity}, so an object reference would hard-wire a
 * cross-context join that {@code package-structure.md} §5 asks us to keep at the id level.
 *
 * <p><strong>No soft-delete triplet</strong> — V117 gives the table none, so this extends {@link
 * AuditedEntity} rather than {@code SoftDeleteEntity}. Rows are answered, never removed; see {@link
 * PhotoRequestStatuses#RESOLVED} and {@link PhotoRequestStatuses#DECLINED} for why the record
 * outlives the nag in both directions.
 */
@Entity
@Table(name = "photo_requests")
@Getter
public class PhotoRequest extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** The asking user. Always taken from the JWT — never from the request body. */
    @Column(name = "requester_id", nullable = false, updatable = false)
    private UUID requesterId;

    /** One of {@link PhotoRequestStatuses}; the V118 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    private String status = PhotoRequestStatuses.PENDING;

    /**
     * When the owner answered, either way. Named for the act rather than the outcome (V118) — a
     * {@code resolvedAt} holding the moment a request was <em>declined</em> would be a column
     * lying about half its rows.
     */
    @Column(name = "decided_at")
    private Instant decidedAt;

    protected PhotoRequest() {
        // JPA
    }

    public PhotoRequest(UUID propertyId, UUID requesterId) {
        this.propertyId = propertyId;
        this.requesterId = requesterId;
    }

    /**
     * Record the owner's answer.
     *
     * <p><strong>Idempotent, and terminal states do not convert into one another.</strong> Once a
     * request is resolved or declined, a later call — with the same decision or the other one — is a
     * no-op that keeps the original {@code decidedAt}. Two things fall out of that: "when did this
     * owner respond" cannot be pushed forward by a repeat call, and an owner cannot walk a decline
     * back into a resolution to clear a badge. The first is the D117 property; the second is why
     * this guards on {@link PhotoRequestStatuses#isTerminal} rather than on equality with the
     * incoming decision.
     *
     * @param decision one of {@link PhotoRequestStatuses#RESOLVED} or
     *                 {@link PhotoRequestStatuses#DECLINED}; validated at the boundary
     */
    public void decide(String decision, Instant at) {
        if (PhotoRequestStatuses.isTerminal(this.status)) {
            return;
        }
        this.status = decision;
        this.decidedAt = at;
    }
}
