package com.draazy.api.services.request;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "service_request_amendments")
@Getter
public class ServiceRequestAmendment extends BaseEntity {

    static final String PROPOSED = "proposed";
    static final String APPLIED = "applied";
    static final String WITHDRAWN = "withdrawn";

    @Column(name = "service_request_id", nullable = false, updatable = false)
    private UUID serviceRequestId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "terms", nullable = false, updatable = false)
    private Map<String, Object> terms;

    @Column(name = "reason", nullable = false, updatable = false, length = 300)
    private String reason;

    @Column(name = "amount_before", nullable = false, updatable = false)
    private long amountBefore;

    @Column(name = "amount_after", nullable = false, updatable = false)
    private long amountAfter;

    @Column(name = "status", nullable = false, length = 10)
    private String status = PROPOSED;

    @Column(name = "payment_ref")
    private String paymentRef;

    @Column(name = "proposed_by", updatable = false)
    private UUID proposedBy;

    @Column(name = "decided_by")
    private UUID decidedBy;

    @Column(name = "decided_at")
    private Instant decidedAt;

    protected ServiceRequestAmendment() {
    }

    ServiceRequestAmendment(UUID serviceRequestId, Map<String, Object> terms, String reason,
            long amountBefore, long amountAfter, UUID proposedBy) {
        this.serviceRequestId = serviceRequestId;
        this.terms = terms;
        this.reason = reason;
        this.amountBefore = amountBefore;
        this.amountAfter = amountAfter;
        this.proposedBy = proposedBy;
    }

    long delta() {
        return amountAfter - amountBefore;
    }

    boolean open() {
        return PROPOSED.equals(status);
    }

    void attachOrder(String orderId) {
        this.paymentRef = orderId;
    }

    void releaseOrder() {
        this.paymentRef = null;
    }

    void close(String outcome, UUID by, Instant at) {
        this.status = outcome;
        this.decidedBy = by;
        this.decidedAt = at;
    }
}
