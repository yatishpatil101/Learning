package com.draazy.api.services.request;

import com.draazy.api.common.persistence.VersionedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

// ServiceRequest owns the workflow after RentAgreementService produces a draft.
@Entity
@Table(name = "service_requests")
@Getter
public class ServiceRequest extends VersionedEntity {

    @Column(name = "requester_id", updatable = false)
    private UUID requesterId;

    @Column(name = "type", nullable = false, updatable = false)
    private String type;

    // The ops desk that works this request.
    // One of com.draazy.api.security.Teams.
    @Column(name = "team", nullable = false, updatable = false)
    private String team;

    @Column(name = "ticket_id", updatable = false)
    private UUID ticketId;

    @Column(name = "status", nullable = false)
    @Convert(converter = ServiceRequestStatus.Converter.class)
    private ServiceRequestStatus status = ServiceRequestStatus.NEW;

    @Column(name = "property_id", updatable = false)
    private UUID propertyId;

    @Column(name = "assignee_id")
    @Setter
    private UUID assigneeId;

    // Structured customer payload; kept as JSON so DTO round-trips the create shape.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "details")
    private Map<String, Object> details;

    @Column(name = "amount")
    private Long amount;

    @Column(name = "status_changed_at", nullable = false)
    private Instant statusChangedAt = Instant.now();

    // Cashfree order id; webhook uses it to find the request.
    // It is attached after commit so payable orders never point at rolled-back rows.
    @Column(name = "payment_ref")
    private String paymentRef;

    protected ServiceRequest() {

    }

    public ServiceRequest(UUID requesterId, String type, UUID propertyId,
            Map<String, Object> details, UUID ticketId) {
        this.requesterId = requesterId;
        this.type = type;
        this.team = ServiceRequestTypes.teamFor(type);
        this.propertyId = propertyId;
        this.details = details;
        this.ticketId = ticketId;
    }

    // Package-private: only the co-fill flow may merge invited-party details.
    void replaceDetails(Map<String, Object> details) {
        this.details = details;
    }

    void charge(long extra) {
        this.amount = (amount == null ? 0L : amount) + extra;
    }

    // Priced requests start at awaiting-payment before Cashfree order creation.
    // The row must commit first, so callbacks can always find it.
    void awaitPayment(long amount) {
        this.status = ServiceRequestStatus.AWAITING_PAYMENT;
        this.amount = amount;
    }

    // Never overwrite an order ref; displaced payable orders would lose their request.
    boolean attachOrder(String orderId) {
        if (status != ServiceRequestStatus.AWAITING_PAYMENT || paymentRef != null) {
            return false;
        }
        this.paymentRef = orderId;
        return true;
    }

    // Only ServiceRequestService moves statuses; it has caller authority and transition rules.
    void moveTo(ServiceRequestStatus status) {
        this.status = status;
        this.statusChangedAt = Instant.now();
    }

}
