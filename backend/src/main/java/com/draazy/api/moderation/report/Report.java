package com.draazy.api.moderation.report;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * One abuse report. Maps the {@code reports} table (V7).
 *
 * <p>Like {@code Review}, the target is a {@code (type, id)} pair rather than a foreign key: the
 * four reportable kinds live in four different tables, and one of them ({@code post}) has no row in
 * this schema at all yet. {@code target_id} is therefore {@code text} and is <em>not</em> resolved
 * or validated against the target table — deliberately. A report about a listing that is deleted a
 * second later is still a report worth reading, and refusing to record a complaint because the
 * thing complained about cannot currently be found would lose exactly the reports that matter most.
 *
 * <p>{@code reporter_id} is nullable in the schema and populated by every report this API writes.
 * It is never client-supplied: it comes from the authenticated principal, because a reporter who
 * can name themselves can also name somebody else.
 *
 * <p>No soft-delete. A report is a record that somebody complained; that is true whatever the
 * outcome, so the terminal states are {@code actioned}/{@code dismissed}, not deletion.
 */
@Entity
@Table(name = "reports")
@Getter
public class Report extends BaseEntity {

    @Column(name = "target_type", nullable = false, updatable = false)
    private String targetType;

    @Column(name = "target_id", nullable = false, updatable = false)
    private String targetId;

    /** Server-resolved from the JWT principal. Never read from the request body. */
    @Column(name = "reporter_id", updatable = false)
    private UUID reporterId;

    @Column(name = "reason", nullable = false, updatable = false)
    private String reason;

    @Column(name = "details", updatable = false)
    private String details;

    @Column(name = "status", nullable = false)
    private String status = ReportStatuses.OPEN;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Report() {
        // JPA
    }

    public Report(String targetType, String targetId, UUID reporterId, String reason, String details) {
        this.targetType = targetType;
        this.targetId = targetId;
        this.reporterId = reporterId;
        this.reason = reason;
        this.details = details;
    }

    /**
     * Move this report through triage.
     *
     * <p>Deliberately not a bare setter: the legality of the move is part of what it means to change
     * a report's state, so the check lives with the mutation rather than relying on every caller to
     * remember it. Callers validate first to produce the contract's 422; this is the backstop.
     *
     * @throws IllegalStateException if the transition is illegal — a bug, not a user error
     */
    public void triage(String next) {
        if (!ReportStatuses.canTransition(this.status, next)) {
            throw new IllegalStateException(
                    "illegal report transition %s -> %s".formatted(this.status, next));
        }
        this.status = next;
    }
}
