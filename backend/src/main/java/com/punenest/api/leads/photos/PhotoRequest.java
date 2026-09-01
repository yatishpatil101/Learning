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
 * AuditedEntity} rather than {@code SoftDeleteEntity}. Rows are resolved, never removed; see {@link
 * PhotoRequestStatuses#RESOLVED} for why the record outlives the nag.
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

    /** One of {@link PhotoRequestStatuses}; the V117 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    private String status = PhotoRequestStatuses.PENDING;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    protected PhotoRequest() {
        // JPA
    }

    public PhotoRequest(UUID propertyId, UUID requesterId) {
        this.propertyId = propertyId;
        this.requesterId = requesterId;
    }

    /**
     * Mark this request satisfied. Idempotent: resolving an already-resolved row keeps the original
     * {@code resolvedAt}, so "when did this owner respond" cannot be pushed forward by a repeat call.
     */
    public void resolve(Instant at) {
        if (PhotoRequestStatuses.RESOLVED.equals(this.status)) {
            return;
        }
        this.status = PhotoRequestStatuses.RESOLVED;
        this.resolvedAt = at;
    }
}
