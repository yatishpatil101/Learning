package com.draazy.api.services.request;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

@Entity
@Table(name = "service_request_refunds")
@Getter
public class ServiceRequestRefund extends BaseEntity {

    static final String REQUESTED = "requested";
    static final String APPROVED = "approved";
    static final String REJECTED = "rejected";

    @Column(name = "service_request_id", nullable = false, updatable = false)
    private UUID serviceRequestId;

    @Column(name = "order_id", nullable = false, updatable = false)
    private String orderId;

    @Column(name = "amount", nullable = false, updatable = false)
    private long amount;

    @Column(name = "duty_paid", nullable = false, updatable = false)
    private boolean dutyPaid;

    @Column(name = "grn", updatable = false, length = 25)
    private String grn;

    @Column(name = "reason", nullable = false, updatable = false, length = 300)
    private String reason;

    @Column(name = "status", nullable = false, length = 10)
    private String status = REQUESTED;

    @Column(name = "requested_by", updatable = false)
    private UUID requestedBy;

    @Column(name = "decided_by")
    private UUID decidedBy;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decision_note", length = 300)
    private String decisionNote;

    @Column(name = "gateway_refund_id")
    private String gatewayRefundId;

    protected ServiceRequestRefund() {
    }

    ServiceRequestRefund(UUID serviceRequestId, String orderId, long amount, boolean dutyPaid, String grn,
            String reason, UUID requestedBy) {
        this.serviceRequestId = serviceRequestId;
        this.orderId = orderId;
        this.amount = amount;
        this.dutyPaid = dutyPaid;
        this.grn = grn;
        this.reason = reason;
        this.requestedBy = requestedBy;
    }

    boolean open() {
        return REQUESTED.equals(status);
    }

    void approve(String gatewayRefund, UUID by, String note) {
        this.gatewayRefundId = gatewayRefund;
        close(APPROVED, by, note);
    }

    void reject(UUID by, String note) {
        close(REJECTED, by, note);
    }

    private void close(String outcome, UUID by, String note) {
        this.status = outcome;
        this.decidedBy = by;
        this.decidedAt = Instant.now();
        this.decisionNote = note;
    }
}
