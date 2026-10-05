package com.draazy.api.moderation.verification;

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
@Table(name = "property_verification_override_requests")
@Getter
public class PropertyOverrideRequest {

    public static final String APPROVE = "approve";
    public static final String REVERSE_REJECT = "reverse_reject";
    public static final String PENDING = "pending";
    public static final String APPROVED = "approved";

    @Id
    @GeneratedValue
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    @Column(name = "requested_by", nullable = false, updatable = false)
    private UUID requestedBy;

    @Column(name = "action", nullable = false, updatable = false)
    private String action;

    @Column(name = "reason", nullable = false, updatable = false)
    private String reason;

    @Column(name = "status", nullable = false)
    private String status = PENDING;

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

    protected PropertyOverrideRequest() {
    }

    PropertyOverrideRequest(UUID propertyId, UUID requestedBy, String action, String reason) {
        this.propertyId = propertyId;
        this.requestedBy = requestedBy;
        this.action = action;
        this.reason = reason;
    }

    boolean isPending() {
        return PENDING.equals(status);
    }

    void approve(UUID checker, String note) {
        if (checker == null || checker.equals(requestedBy)) {
            throw new IllegalArgumentException("checker may not be maker: " + id);
        }
        this.status = APPROVED;
        this.decidedBy = checker;
        this.decidedAt = Instant.now();
        this.decisionNote = note;
    }
}
