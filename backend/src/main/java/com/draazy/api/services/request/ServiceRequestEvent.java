package com.draazy.api.services.request;

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
 * One entry in a service request's history — "assigned to Rohit", "draft shared", "customer
 * approved". Maps {@code service_request_timeline} (V7).
 *
 * <p><strong>Written by the server, never by a person.</strong> That is the whole distinction from
 * {@link ServiceRequestMessage}: a timeline entry states what the system did, a message states what
 * somebody said. Merging the two would make "staff says the deed is missing" indistinguishable from
 * "status changed to in-progress", and would put customer free text into what is effectively an
 * audit trail.
 *
 * <p>Append-only. There is no setter and no delete path: a history that can be rewritten is not a
 * history.
 *
 * <p>Extends nothing. {@code BaseEntity} would bring {@code created_at}, and this table has {@code at}
 * instead — V7's column, and the one the contract puts on the wire.
 */
@Entity
@Table(name = "service_request_timeline")
@Getter
public class ServiceRequestEvent {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "request_id", nullable = false, updatable = false)
    private UUID requestId;

    @CreationTimestamp
    @Column(name = "at", nullable = false, updatable = false)
    private Instant at;

    /** Dotted, machine-readable: {@code status.assigned}, {@code draft.shared}, {@code draft.approved}. */
    @Column(name = "event", nullable = false, updatable = false)
    private String event;

    /**
     * Who caused it, as a display name.
     *
     * <p>A name and not an id, because the contract puts this field straight on the wire for a
     * customer to read and "assigned to 7a3f-…" tells them nothing. The accountable record — actor
     * id, role, before and after — is the {@code audit_log} row written alongside; this is the
     * human-facing narration of it.
     */
    @Column(name = "by", updatable = false)
    private String by;

    protected ServiceRequestEvent() {
        // JPA
    }

    ServiceRequestEvent(UUID requestId, String event, String by) {
        this.requestId = requestId;
        this.event = event;
        this.by = by;
    }

}
