package com.punenest.api.services.ticket;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UuidGenerator;

/**
 * An internal staff note on a ticket. Maps {@code ticket_notes} (V7).
 *
 * <p><strong>Append-only and internal.</strong> There is no update or delete path and no
 * customer-facing read: this is where ops write "customer says the tenant left, chasing owner", and
 * a note that can be edited after the fact is worth nothing in a dispute.
 *
 * <p>Extends nothing — the table has {@code at} rather than {@code created_at}, so {@code BaseEntity}
 * does not fit.
 */
@Entity
@Table(name = "ticket_notes")
@Getter
public class TicketNote {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "ticket_id", nullable = false, updatable = false)
    private UUID ticketId;

    /** The author's display name — the contract's {@code by}. */
    @Column(name = "by", updatable = false)
    private String by;

    @Column(name = "text", nullable = false, updatable = false)
    private String text;

    @CreationTimestamp
    @Column(name = "at", nullable = false, updatable = false)
    private Instant at;

    protected TicketNote() {
        // JPA
    }

    TicketNote(UUID ticketId, String by, String text) {
        this.ticketId = ticketId;
        this.by = by;
        this.text = text;
    }

}
