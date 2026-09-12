package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * One person asking one host for one seat — the host-facing inbox (V27 {@code flatmate_requests}).
 *
 * <p><strong>Polymorphic on {@code (kind, targetId)} rather than three nullable foreign keys.</strong>
 * The inbox is read as a single list ordered by time, across all three target types; three columns
 * of which exactly two are always null is a shape that invites a query to forget one of them, and
 * the bug that follows is a silently missing row rather than an error.
 *
 * <p>The trade-off is stated honestly: there is no FK, so nothing at the database level stops a
 * dangling target. That is acceptable only because every target type is soft-deleted — rows are
 * archived, never removed — so the target a request points at always exists.
 *
 * <p>{@link #hostId} is denormalised at write time. The alternative is resolving the target on every
 * inbox read to discover who owns it, which is a three-way union per row to learn something that was
 * already known when the row was written.
 */
@Entity
@Table(name = "flatmate_requests")
@Getter
public class FlatmateRequest extends AuditedEntity {

    /** Which collection {@link #targetId} points into: {@code flatmate}, {@code room} or {@code group}. */
    @Column(name = "kind", nullable = false, updatable = false)
    private String kind;

    @Column(name = "target_id", nullable = false, updatable = false)
    private UUID targetId;

    @Column(name = "host_id", nullable = false, updatable = false)
    private UUID hostId;

    @Column(name = "requester_id", nullable = false, updatable = false)
    private UUID requesterId;

    /**
     * {@code request} needs the host's approval; {@code join} records that an open-policy group was
     * joined outright. Both appear in the inbox — a host still wants to see who arrived.
     */
    @Column(name = "action", nullable = false)
    private String action = "request";

    @Column(name = "share", nullable = false)
    private String share = "solo";

    @Column(name = "message")
    private String message;

    @Column(name = "status", nullable = false)
    private String status = FlatmateVocabulary.STATUS_PENDING;

    @Column(name = "requested_at", nullable = false, updatable = false)
    private Instant requestedAt = Instant.now();

    @Column(name = "decided_at")
    private Instant decidedAt;

    protected FlatmateRequest() {
    }

    FlatmateRequest(String kind, UUID targetId, UUID hostId, UUID requesterId,
            String action, String share, String message) {
        this.kind = kind;
        this.targetId = targetId;
        this.hostId = hostId;
        this.requesterId = requesterId;
        this.action = action;
        this.share = share;
        this.message = message;
        // An open-policy join is not a question, so it is not left pending — it already happened.
        // The DB check constraint requires a decided_at to travel with any non-pending status.
        boolean joined = "join".equals(action);
        this.status = joined ? "accepted" : FlatmateVocabulary.STATUS_PENDING;
        this.decidedAt = joined ? Instant.now() : null;
    }

    /** The host's decision. The check constraint guarantees the timestamp travels with it. */
    void decide(String decision) {
        this.status = decision;
        this.decidedAt = Instant.now();
    }

    public boolean isPending() {
        return FlatmateVocabulary.STATUS_PENDING.equals(status);
    }
}
