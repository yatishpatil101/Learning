package com.draazy.api.moderation.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "badge_grant_requests")
@Getter
class BadgeGrantRequest {

    @Id
    @GeneratedValue
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "requested_by", nullable = false, updatable = false)
    private UUID requestedBy;

    @Column(name = "reason", nullable = false, updatable = false)
    private String reason;

    @Column(name = "status", nullable = false)
    private String status = BadgeGrantStatuses.PENDING;

    @Column(name = "decided_by")
    private UUID decidedBy;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decision_note")
    private String decisionNote;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected BadgeGrantRequest() {
    }

    BadgeGrantRequest(UUID userId, UUID requestedBy, String reason) {
        this.userId = userId;
        this.requestedBy = requestedBy;
        this.reason = reason;
    }

    boolean isPending() {
        return BadgeGrantStatuses.PENDING.equals(status);
    }

    void approve(UUID checker, String note) {
        decide(BadgeGrantStatuses.APPROVED, checker, note);
    }

    void reject(UUID checker, String reason) {
        decide(BadgeGrantStatuses.REJECTED, checker, reason);
    }

    private void decide(String next, UUID checker, String note) {
        if (checker == null || checker.equals(requestedBy) || checker.equals(userId)) {
            throw new IllegalArgumentException("checker may not be maker or subject: " + id);
        }
        this.status = next;
        this.decidedBy = checker;
        this.decidedAt = Instant.now();
        this.decisionNote = note;
    }
}
