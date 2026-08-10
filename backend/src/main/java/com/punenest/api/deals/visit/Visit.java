package com.punenest.api.deals.visit;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * A visit booking on a listing — the row behind the visitor/owner lifecycle. Maps {@code visits}
 * (V4).
 *
 * <p><strong>Why in the {@code deals} package when the table came from V4 (leads).</strong>
 * The four transaction-core features (offers, deals, visits, finalization) live together because
 * they share a domain boundary: all are flows between a listing owner and an interested party,
 * gated by the same mobile-masking rules and the same participant-vs-authorisation split. The table
 * happened to land in V4 alongside contacts, but the behavioural affinity is with the deal flow,
 * not the contact gate. This split is documented here so a future reader does not "fix" it back
 * into leads.
 *
 * <p><strong>Ids, not associations.</strong> {@code propertyId} and {@code visitorId} are plain
 * UUID columns rather than {@code @ManyToOne} graphs, for the same reason as {@code Offer}: an
 * eager association is an N+1 waiting to happen, and this entity lives in the {@code deals}
 * context while the targets live in {@code catalog} and {@code identity}.
 */
@Entity
@Table(name = "visits")
@Getter
public class Visit extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** The visitor who booked. Always taken from the JWT — never from the request body. */
    @Column(name = "visitor_id", nullable = false, updatable = false)
    private UUID visitorId;

    /** The proposed date/time, stored as a single ISO timestamptz (reconciliation item c). */
    @Column(name = "slot", nullable = false)
    private Instant slot;

    /** One of {@link VisitModes}; the V4 CHECK rejects anything else. */
    @Column(name = "mode", nullable = false)
    private String mode = VisitModes.IN_PERSON;

    /** One of {@link VisitStatuses}; the V4 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    @Setter
    private String status = VisitStatuses.SCHEDULED;

    /** Optional free-text note from the visitor. */
    @Column(name = "note")
    private String note;

    protected Visit() {
        // JPA
    }

    public Visit(UUID propertyId, UUID visitorId, Instant slot, String mode, String note) {
        this.propertyId = propertyId;
        this.visitorId = visitorId;
        this.slot = slot;
        this.mode = mode != null ? mode : VisitModes.IN_PERSON;
        this.note = note;
    }

    /**
     * Move this visit to {@code newSlot} and return it to {@code scheduled} — a moved slot is not
     * one the other party has agreed to yet, so it must be re-confirmed (D87). Terminal-state
     * guarding lives in the service; this is the state change once that check has passed.
     */
    public void reschedule(Instant newSlot) {
        this.slot = newSlot;
        this.status = VisitStatuses.SCHEDULED;
    }

}
